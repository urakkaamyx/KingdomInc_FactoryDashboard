"""Build reproducible manual-install and developer archives without local state."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parents[1]
API = PROJECT.parent / 'FactoryPlannerApi'
GAME = PROJECT.parents[1]
OUT = PROJECT / 'Releases' / 'Nexus'
VERSION = ET.parse(API / 'KingdomFactoryApi.csproj').getroot().findtext('PropertyGroup/Version')
PLUGIN_PATH = 'BepInEx/plugins/KingdomFactoryApi/KingdomFactoryApi.dll'
MANIFEST_PATH = '_Mods/FactoryDashboard/package-manifest.json'
SKIP = {'bin', 'obj', 'releases', 'verification', '__pycache__', '.git'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')

def add_file(entries, path, target):
    assert target not in entries, target
    entries[target] = path.read_bytes()

def add_tree(entries, root, prefix, skip=SKIP):
    for path in sorted(root.rglob('*')):
        if path.is_file() and not any(p.lower() in skip for p in path.relative_to(root).parts):
            add_file(entries, path, prefix + '/' + path.relative_to(root).as_posix())

def archive(path, entries):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, data in sorted(entries.items()):
            # Fixed timestamps make identical source trees produce identical ZIPs.
            info = zipfile.ZipInfo(name, (2026, 11, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            output.writestr(info, data)
    with zipfile.ZipFile(path) as check:
        assert check.testzip() is None
        assert len(check.namelist()) == len(set(check.namelist()))
        for name, data in entries.items():
            assert check.read(name) == data, name

def main():
    assert VERSION == re.search(r'Version = "([^"]+)"', (API / 'Core/ApiBuild.cs').read_text()).group(1)
    dll = API / 'bin/Release/netstandard2.1/KingdomFactoryApi.dll'
    release = json.loads((API / f'Verification/release-{VERSION}.json').read_text())
    assert digest(dll.read_bytes()) == release['sha256'], 'DLL differs from verified Release build'
    assert release['diagnosticsExcludedFromNormalBuild']
    provenance = json.loads((API / 'Resources/provenance.json').read_text())
    expected_game = provenance['files']['KingdomInc_Data/Managed/Assembly-CSharp.dll']
    assert digest((GAME / 'KingdomInc_Data/Managed/Assembly-CSharp.dll').read_bytes()) == expected_game
    OUT.mkdir(parents=True, exist_ok=True)

    payload = {}
    add_file(payload, dll, PLUGIN_PATH)
    for asset in (PROJECT / 'dist').rglob('*'):
        if asset.is_file():assert asset.suffix.lower() in {'.html', '.js', '.json', '.css', '.png', '.ttf'}, asset
    add_tree(payload, PROJECT / 'dist', '_Mods/FactoryDashboard/dist')
    for name in ['run.ps1', 'start.ps1', 'stop.ps1', 'serve.py']:
        add_file(payload, PROJECT / name, '_Mods/FactoryDashboard/' + name)
    for name in ['Start Factory Planner.cmd', 'Stop Factory Planner.cmd', 'Factory Planner README.txt', 'Factory Planner CHANGELOG.txt']:
        data = (PROJECT / 'Nexus' / name).read_text(encoding='utf-8')
        payload[name] = data.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
    add_file(payload, API / 'README.md', '_Mods/FactoryDashboard/Docs/API.md')
    add_file(payload, API / 'openapi.json', '_Mods/FactoryDashboard/Docs/openapi.json')
    add_file(payload, PROJECT / 'README.md', '_Mods/FactoryDashboard/Docs/dashboard.md')
    manifest = {
        'name': 'Kingdom Inc. Factory Planner', 'version': VERSION, 'apiPluginVersion': VERSION,
        'installation': 'Manual extraction into the directory containing KingdomInc.exe',
        'requirements': ['Kingdom Inc. Windows x64 Mono', 'BepInEx 5.4.23.5+ (5.x)', 'Python 3.9+ on PATH', 'Modern browser'],
        'referenceGameAssemblySha256': expected_game,
        'files': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(payload.items())}
    }
    payload[MANIFEST_PATH] = json_bytes(manifest)
    main_zip = OUT / f'KingdomInc-FactoryPlanner-{VERSION}.zip'
    archive(main_zip, payload)

    source = {}
    for project in [API, PROJECT]:
        # Developer downloads follow each repository's publication exclusions.
        eligible = subprocess.check_output([
            'git', '-C', str(project), 'ls-files', '--cached', '--others',
            '--exclude-standard', '-z'
        ]).decode('utf-8').split('\0')
        for name in sorted(set(eligible) - {''}):
            path = project / name
            if path.is_file():
                add_file(source, path, '_Mods/' + project.name + '/' + name)
    source['DEVELOPER README.txt'] = (
        'Kingdom Inc. Factory Planner developer source - ' + VERSION + '\n\n'
        'This is not the player installation archive. It contains source and prepared\n'
        'dashboard resources, without game assemblies, loader binaries or local state.\n'
        'Extract under a Kingdom Inc. development game root with BepInEx 5 installed.\n'
        'API build: dotnet build _Mods/FactoryPlannerApi/KingdomFactoryApi.csproj -c Release\n'
        'Package: python _Mods/FactoryDashboard/tools/package_nexus.py\n'
        'Read the individual project READMEs for asset preparation and verification.\n'
        'Asset regeneration requires your local Extracted game references. Some browser\n'
        'tests require locally generated Verification fixtures; those snapshots and\n'
        'release evidence are intentionally not distributed. Packaging checks the local\n'
        'verified Release report before creating the player archive.\n'
        'There are no game saves, logs, .git history or user browser profiles here.\n'
    ).encode('utf-8')
    source_zip = OUT / f'KingdomInc-FactoryPlanner-{VERSION}-source.zip'
    archive(source_zip, source)
    for name in ['NEXUS_DESCRIPTION.bbcode.txt', 'NEXUS_UPLOAD_NOTES.md', 'Factory Planner CHANGELOG.txt']:
        (OUT / name).write_bytes((PROJECT / 'Nexus' / name).read_bytes())
    checksums = {path.name: digest(path.read_bytes()) for path in [main_zip, source_zip]}
    (OUT / 'SHA256.json').write_bytes(json_bytes(checksums))
    print(json.dumps({'version': VERSION, 'mainFiles': len(payload), 'sourceFiles': len(source), 'archives': [
        {'file': path.name, 'bytes': path.stat().st_size, 'sha256': checksums[path.name]} for path in [main_zip, source_zip]
    ]}, indent=2))

if __name__ == '__main__':
    main()
