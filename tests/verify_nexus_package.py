"""Fresh-install smoke test; never installs into or stops the running game."""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import urlopen
import zipfile
from playwright.async_api import async_playwright
from verify_dashboard import fixtures, PROJECT

OUT = PROJECT / 'Releases/Nexus'
PACKAGE = OUT / 'KingdomInc-FactoryPlanner-0.1.3.zip'
MANIFEST = '_Mods/FactoryDashboard/package-manifest.json'

def powershell(script, *args):
    # A detached Windows child can retain inherited pipe handles after PS exits.
    # File-backed capture lets us wait for the launcher alone, not its server.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as error:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script), *args],
                                stdin=subprocess.DEVNULL, stdout=output, stderr=error, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        output.seek(0);error.seek(0)
        stdout, stderr = output.read().decode(errors='replace'), error.read().decode(errors='replace')
    assert result.returncode == 0, stdout + stderr
    return stdout

async def main():
    extraction = Path(tempfile.mkdtemp(prefix='nexus-install-', dir=PROJECT / 'Verification'))
    with zipfile.ZipFile(PACKAGE) as archive:
        manifest = json.loads(archive.read(MANIFEST))
        names = archive.namelist()
        for name in names:
            assert not name.startswith(('/', '\\')) and '..' not in Path(name).parts
            assert not any(part in {'Verification', '_Backup', 'bin', 'obj', '__pycache__'} for part in Path(name).parts)
            assert not name.endswith(('.bak', '.log', '.pdb', '.cfg', '.zip'))
            assert 'runtime-snapshot' not in name
            if name.endswith('.dll'):assert name == 'BepInEx/plugins/KingdomFactoryApi/KingdomFactoryApi.dll'
        assert set(names) == set(manifest['files']) | {MANIFEST}
        archive.extractall(extraction)
        for name, record in manifest['files'].items():
            data = (extraction / name).read_bytes()
            assert len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256'], name
        assert (extraction / '_Mods/FactoryDashboard/dist/money.js').read_bytes() == (PROJECT / 'dist/money.js').read_bytes()

    with socket.socket() as selection:
        selection.bind(('127.0.0.1', 0));port = selection.getsockname()[1]
    root = extraction / '_Mods/FactoryDashboard'
    address = f'http://127.0.0.1:{port}'
    catalog, snapshot = fixtures()
    snapshot['sections']['economy']['data']['currencies'] = {'Gold': '123456', 'Requisition': '43', 'Medal': '120'}
    async def route_api(route):
        path = route.request.url.split('17840', 1)[1]
        if 'health' in path:body = {'apiVersion': '1', 'instanceId': snapshot['instanceId'], 'sessionId': snapshot['sessionId'], 'status': 'live', 'stale': False, 'readOnly': True, 'revision': snapshot['revision']}
        elif 'catalog' in path:body = catalog
        elif 'changes' in path:body = {'apiVersion': '1', 'instanceId': snapshot['instanceId'], 'sessionId': snapshot['sessionId'], 'revision': snapshot['revision'], 'resyncRequired': False, 'changes': []}
        else:body = snapshot
        await route.fulfill(content_type='application/json', body=json.dumps(body), headers={'Access-Control-Allow-Origin': '*'})
    errors, failed_resources = [], []
    try:
        output = powershell(root / 'start.ps1', '-Port', str(port), '-NoBrowser')
        assert 'Factory Dashboard:' in output
        with urlopen(address) as response:
            assert 'no-cache' in response.headers['Cache-Control']
            assert b'Factory Planner' in response.read()
        for relative in ['money.js', 'assets/icons/Icons_8.png', 'assets/icons/Icons_9.png', 'assets/icons/Icons_10.png', 'assets/fonts/numbers.ttf']:
            with urlopen(address + '/' + relative) as response:
                assert response.read() == (root / 'dist' / relative).read_bytes()
        for private in ['/package-manifest.json', '/Verification/server.json', '/serve.py']:
            try:urlopen(address + private)
            except HTTPError as error:assert error.code == 404
            else:raise AssertionError('Private project file exposed: ' + private)
        # Running twice reuses the same owned server instead of starting another.
        before = json.loads((root / 'Verification/server.json').read_text(encoding='utf-8-sig'))
        assert 'already running' in powershell(root / 'start.ps1', '-Port', str(port), '-NoBrowser')
        after = json.loads((root / 'Verification/server.json').read_text(encoding='utf-8-sig'))
        assert before['pid'] == after['pid']
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={'width':1440, 'height':1000})
            await context.route('http://127.0.0.1:17840/**', route_api)
            page = await context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: failed_resources.append(r.url) if r.status >= 400 and 'favicon' not in r.url else None)
            await page.goto(address)
            await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
            assert await page.locator('.currency-amount[title="Gold"] .coin-value').all_text_contents() == ['12', '34', '56']
            await page.screenshot(path=str(PROJECT / 'Verification/nexus-packaged-overview.png'), full_page=True)
            await page.locator('.add-production').click()
            await page.locator('#production-kind').select_option('objective')
            await page.locator('[data-item="Shop"]').click()
            await page.locator('#create-goal').click()
            await page.locator('#add-objective-input').select_option('iron_sword')
            await page.locator('[data-action="generate-layout"]').click()
            await page.locator('.layout-svg').wait_for()
            assert await page.locator('.layout-node').count() > 1
            for width in [1024, 390]:
                await page.set_viewport_size({'width':width, 'height':844})
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert not errors, errors
            assert not failed_resources, failed_resources
            await browser.close()
    finally:
        powershell(root / 'stop.ps1')
    try:urlopen(address, timeout=1)
    except OSError:pass
    else:raise AssertionError('Test server was not stopped')
    report = {'passed':True, 'testedAtUtc':datetime.now(timezone.utc).isoformat(), 'mainArchive':PACKAGE.name,
              'sha256':hashlib.sha256(PACKAGE.read_bytes()).hexdigest(), 'manifestFilesVerified':len(manifest['files']),
              'freshExtraction':True, 'launcherStartedHiddenServer':True, 'secondLaunchReusesServer':True,
              'stopScriptStoppedOnlyTestServer':True, 'privateFilesNotServed':True, 'packagedMoneyDisplay':True,
              'packagedObjectiveLayout':True, 'responsiveWidths':[1440,1024,390], 'pageErrors':errors,
              'failedResources':failed_resources, 'gameMutations':False}
    (PROJECT / 'Verification/nexus-package-tests.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':asyncio.run(main())
