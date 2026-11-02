"""Version-pinned equipment traits from the preserved game definitions (no save data)."""
import json, re
from pathlib import Path

project = Path(__file__).resolve().parents[1]
extracted = project.parents[1] / 'Extracted'
catalog = json.loads((project / 'dist/catalog.json').read_text(encoding='utf-8'))
traits = {}
for item in catalog['reference']['items']:
    if item['definition_type'] not in ('EquipmentItemType', 'WeaponItemType'):
        continue
    source = (extracted / item['source']).read_text(encoding='utf-8')
    start = source.index('("' + item['id'] + '")')
    end = source.find('ItemType.Add(', start + 1)
    block = source[start:end if end >= 0 else len(source)]
    armor = re.search(r'ArmorType\s*=\s*ArmorType\.(\w+)', block)
    traits[item['id']] = {'armorType': armor.group(1) if armor else 'None'}
(project / 'dist/item-traits.json').write_text(json.dumps(traits, indent=2) + '\n', encoding='utf-8')
print(f'Prepared traits for {len(traits)} equipment definitions.')
