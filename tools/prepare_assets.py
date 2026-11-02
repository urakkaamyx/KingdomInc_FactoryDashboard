"""Copy original game artwork and fonts for a local-only dashboard."""
from pathlib import Path
import json, shutil

project = Path(__file__).resolve().parents[1]
game = project.parents[1]
extracted = game/'Extracted'
out = project/'dist/assets'
assets = json.loads((extracted/'asset_index.json').read_text(encoding='utf-8'))
sprites = {a['name']: a['exports'][0] for a in assets if a['type']=='Sprite' and a.get('exports')}
for folder in ['icons','rooms','theme','fonts']: (out/folder).mkdir(parents=True, exist_ok=True)
for name, relative in sprites.items():
    if name.startswith('Icons'): shutil.copy2(extracted/relative, out/'icons'/f'{name}.png')
theme = ['DefaultBorderDark','DefaultResource','DefaultUtility','TitleRed','TitleYellow','DecoTitleDark','IOGreen_0','IOBlue_0']
for name in theme:
    if name in sprites: shutil.copy2(extracted/sprites[name], out/'theme'/f'{name}.png')
buildings = json.loads((extracted/'CalculatorData/planner_rules.json').read_text())['buildings']
rooms = {}
for name in buildings:
    if name in sprites:
        shutil.copy2(extracted/sprites[name], out/'rooms'/f'{name}.png'); rooms[name]=name
for pattern, destination in [('**/*pixelFJ8pt1*.ttf','pixel.ttf'),('**/*PerfectDOS*.ttf','numbers.ttf'),('**/*LiberationSans*.ttf','body.ttf')]:
    source = next((extracted/'Exports/Font').glob(pattern))
    shutil.copy2(source, out/'fonts'/destination)
shutil.copy2(project.parent/'FactoryPlannerApi/Web/client.js', project/'dist/client.js')
catalog=project.parent/'FactoryPlannerApi/Verification/runtime-catalog.json'
if catalog.exists(): shutil.copy2(catalog, project/'dist/catalog.json')
(project/'dist/assets.json').write_text(json.dumps({'rooms': rooms,'icons':sorted(n for n in sprites if n.startswith('Icons'))}),encoding='utf-8')
print(f'Prepared {len(rooms)} room sprites, fonts, frames and {sum(n.startswith("Icons") for n in sprites)} icons.')
