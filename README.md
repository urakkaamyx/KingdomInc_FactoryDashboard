# Kingdom Inc. Factory Planner — 0.1.4

A local browser dashboard for the Factory API. Uses the original game's pixel fonts, bronze frames, burgundy panels, icons and room artwork. It runs separately from the game and works with API v1, including existing v0.1.x plugin builds.

## Install and start

Download `KingdomInc-FactoryPlanner-0.1.4.zip` from this repository's Releases. It includes the dashboard and Factory API 0.1.3. Requires Kingdom Inc. Windows x64 Mono, BepInEx 5.4.23.5+ in the 5.x series, Python 3.9+ available as `python`, and a modern browser. Install BepInEx and Python separately.

1. Close the game and extract the ZIP into the directory containing `KingdomInc.exe`, merging `BepInEx` and `_Mods`.
2. Confirm the plugin is at `BepInEx/plugins/KingdomFactoryApi/KingdomFactoryApi.dll` and the dashboard at `_Mods/FactoryDashboard`.
3. Start the game and load a kingdom, then double-click `Start Factory Planner.cmd` to open the dashboard.
4. Use `Stop Factory Planner.cmd` to stop its background web server when finished.

Manual installation is verified; Vortex deployment is untested. The API is also available separately in [KingdomInc_FactoryPlannerApi](https://github.com/urakkaamyx/KingdomInc_FactoryPlannerApi). API 0.1.3 is required for measured flow and earnings; older APIs leave those measurements pending.

To update, stop the dashboard, close the game, replace this package's files and restart both. Browser-local plans remain in place. To uninstall, stop the dashboard and close the game, then remove only `_Mods/FactoryDashboard`, `BepInEx/plugins/KingdomFactoryApi` and this package's launchers/documentation. The optional API configuration is `BepInEx/config/urakka.kingdominc.factoryapi.cfg`. Browser-local plans persist until this site's storage is cleared.

Open **http://127.0.0.1:17841** while the dashboard server is running. The API defaults to **http://127.0.0.1:17840**; change the address using the connection settings button. The dashboard reconnects automatically when the game starts and clears live kingdom data at the main menu. If the game exits, it labels retained browser data as the last synced state.

From the game directory:

```powershell
& ./_Mods/FactoryDashboard/run.ps1
```

This starts a hidden Python server on IPv4 localhost. It stays available independently of the game; it does not register a startup task. To stop this project's recorded server:

```powershell
& ./_Mods/FactoryDashboard/stop.ps1
```

The game needs the Factory API plugin running to provide live data. This dashboard never purchases research, moves buildings, writes a kingdom save, or sends gameplay commands. Goals and a last-known snapshot are saved in this browser's local storage, separately from the old Workshop profiles. The static server only serves `dist/`; game files and saves are not exposed through it.

## Views

- **Overview:** live building/machine counts, connections, recipe/research totals, workshop floors organized by in-game Containers, resource quotas, recent demand samples, available research, balances and observed changes. Treasury shows a net rate per currency over up to 60 seconds of live observations: green profit, red deficit, or neutral balanced. Rates measure actual balance changes (including purchases, refunds, and collections), rather than predicted factory revenue. Initial sampling, disconnections, long observation gaps, and kingdom changes reset the measurement; cached balances never carry a live profit rate. Int64 balance strings are subtracted with BigInt before rate conversion. Containers expand to show their building groups and nested Containers; buildings outside all Containers have their own section.
- **Production:** choose a product or an objective building. Product rates may be entered per second or per minute. Objectives have editable incoming items, individual feed rates, and a choice of dedicated production or existing supply. Each stream supports ordered Outfitter and Training Grounds stages; equipment supports compatible engraving, enchantment and blessing recipes before outfitting. Stages can be reordered or removed. “Use supply” stops expansion at an ingredient so it can be allocated separately.
- **Resources:** total kingdom quotas, current demand, spare capacity, combined additional demand from all goals, and Forest workforce data.
- **Research:** search and filter available, purchased, or locked technology; inspect requirements. Availability does not imply the player can afford the purchase.
- **Factory:** expandable Container sections hold their building lists and nested Containers. Search/filter by Container or type, and inspect sampled progress/status, stacks, effective speed, upgrades, ports and utility settings. Parent Container filters include descendants. Container headings use the in-game text labels, including labels crossing the top border, and contained icon stickers appear beside the heading. Each label or sticker belongs to its smallest containing Container. Open/closed sections are retained through live updates. Sampled status is not a measured long-term bottleneck.

Containers are the game's rectangular `FlowDeco` decorations, distinct from workflow tabs. A child must fit completely within its parent; the smallest enclosing Container becomes its parent. Buildings are assigned once by anchor position to the smallest containing rectangle. Parent totals include descendants; each building row is displayed only in its direct owner. Text labels anchored inside a Container supply its heading when present; otherwise it receives a numbered label. Geometry is read coherently with the factory through the existing API's native section. The browser cache retains only the decoration projection of that section.

Money uses the game's Gold, Silver and Copper icons in descending order: 100 Copper = 1 Silver and 100 Silver = 1 Gold. API `Gold` values are copper units. Balances retain exact integer precision; per-second money rates round to the nearest whole copper before denomination conversion. This applies to Treasury balances and net rates, Container revenue/profit, and production operating costs. Other currencies keep their own icons and units. All three denominations stay visible, including zero Gold or Silver, so their positions remain Gold → Silver → Copper. All three coin amounts are whole numbers; fractions of Gold and Silver are converted to the smaller denominations. Calculations retain their original precision. Run `python _Mods/FactoryDashboard/tests/verify_money.py` to check conversion boundaries, fractional carries, large balances and responsive coin display.

## Planning scope

### Generated layouts

After choosing a product or objective, inputs and preparation, use **Generate layout**. The browser saves a connected build guide per production. Identical parallel machines are grouped into compact banks, with suggested rows/columns. **Expand** shows every individual machine in left-to-right Flow view, with numbered machines, per-machine rates, and one physical pipe per connection. **Group machines** restores compact banks. This view supports up to 2,000 nodes; split larger plans into smaller goals to expand them. **Fullscreen** opens a full-window view and fits the entire graph in both dimensions. Grouped plans have a compact overview that uses rows to make better use of the screen; **Flow view** returns to the left-to-right arrangement. Individual machines retain their Flow arrangement in fullscreen. **Exit fullscreen** or Escape restores the inline viewport. Both representations retain zooming, panning, node details, direct-family highlights and regeneration; resizing in fullscreen refits the graph. Downloading an expanded plan includes the individual nodes and physical pipes.

Hover a node to preview its direct family, or press Enter to pin that selection. Clicking a node pins it and immediately opens its details. Direct parents are labelled P1, P2… and children C1, C2…; rainbow colors match each neighbor's border, badge and connection. Unrelated nodes are dimmed. **Clear** removes the selection. Click a node or choose **Node details** to inspect its modifiers, recipe, utility settings, numbered input/output connections and per-machine pipe bundles. The Modifiers section records equipment with its enhancements, ordered training passes (including second-pass effectiveness), preparation carried through routing to destinations, and the per-machine speed/cycle/slot basis used by the estimate. Sampled upgrade slots are labelled as the reference station’s loadout, rather than upgrades assigned to the generated machines. These details are saved with the layout and stay unchanged until regeneration; older guides need regeneration to include them. All connection paths use horizontal and vertical segments with sharp 90-degree turns. Use the mouse wheel over the canvas to zoom around the cursor in either view; drag the background to pan. Zoom buttons, Fit and scrollbars remain available. **Download plan** exports the versioned JSON guide. The guide is for manual placement in-game and is not a game-save import.

Routing respects one connection per physical port. Manifolds have at most four input/output pairs, Collectors at most four inputs, and Distributors at most four outputs, matching the in-game UI limits. Larger merges and branches use multiple utilities in a tree. Grouped pipe bundles identify the machine ranges served by each utility; expanding resolves those ranges to individual machines. Saved guides made before these limits are marked outdated and need regeneration. Collectors merge streams, Distributors feed identical parallel machines, and an unlocked Manifold can combine collection and distribution to reduce clutter. Unequal shared demands use an unlocked Manifold or an unlocked Distributor; the native Distributor cycles outputs and skips blocked branches. Branch rates are demand budgets, not configured split ratios. The generator never inserts locked routing utilities. When a required merge or split has no unlocked routing option, generation explains which research is needed. Older saved guides are marked outdated and must be regenerated for these rules. Optional unlocked Stockpiles buffer equipment and destination supplies, using the normal output and base capacity 10; overflow is left unconnected. Storage adds no throughput. Switches, timers, buttons and filters are not inserted into single-destination, single-item routes without a corresponding routing need.

Machine counts match the supply/preparation estimate. Utility counts and the destination building are listed separately. Dungeon and Arena guides connect all required party/opponent input slots and explain their cyclic feed assignment. Encounter/contract settings, equipment history, energy requirements, output collection and unused byproducts still need attention in-game. Generated guides retain their wiring while live data refreshes. Edits or relevant unlock/speed changes mark a guide as outdated; **Regenerate layout** updates it explicitly.

The planner uses runtime recipe times/counts and currently available item/building flags from the API. In particular, starter or quest-granted resource access is recognized even when a quota-upgrade research node is unpurchased. Resource source definitions come from the version-pinned extracted reference. Supply quotas stay shared across all goals.

Counts use the median effective speed per unstacked machine for matching placed buildings; otherwise they use base speed. They assume continuous operation, and warn when automation or required research is unavailable. They do not credit productivity or byproducts. Shared ingredients within one goal are aggregated; goals remain separate. Existing gross factory capacity is not assumed to be spare capacity. Unknown/external supplies and Forest allocation need manual budgeting. Probabilistic and custom-result recipes are not offered as fixed-rate production targets. Compatible filtered enhancement recipes are explicitly selected as preparation stages, including their catalysts, operating currencies and machine counts.

Objective targets include the Item Shop, Requisition Office, War Effort, Quest Board, Dungeon, Arena, Restaurant, Luxury Shop, Mercenary Guild, Disenchanter, Nightmare Distiller, Training Grounds, Armory, Hoard and Portal. The demo Turtle has no input ports and is excluded. Input choices follow the preserved class filters and current research. Requisition contract mismatches are warnings because contracts can change. Quality-dependent acceptance and finite storage are explained on the plan. Objective rates mean incoming supply; encounter wins, currency yields and survivor reuse are not inferred. Supply and preparation machine totals exclude the destination building, whose capacity is encounter or storage dependent.

Outfitters budget one equipment item per incoming human and one stage per equipment piece. The planner checks equipment-slot research and loadout conflicts. Enhancement types respect Enhance Multiple research. Training assumes full cycles with enough energy, current slot upgrades, and the food acceleration only when food is equipped before training; consumed food is removed from the later loadout. Second conscript training has half effect, and third or later passes are flagged as ineffective. Existing input supplies may already carry equipment, enhancements or training; their history is not inferred. Balances and operating costs use the original currency icons; balance strings retain full Int64 precision.

“Additional demand” describes new planned chains alongside existing production: spare kingdom quota already subtracts the game's current demand. These are planning estimates, not measurements of achieved output or a claim that a new chain has been built. A future planner can add explicit factory assignments and actual throughput measurements.

The bundled catalog contains definitions from the last verified API catalog, without player progress. It allows planning ahead while the game is offline; actual unlocks and speeds require a synced kingdom. No demonstration kingdom is loaded into the user's dashboard. Browser tests intercept the API in isolated contexts and their screenshots are marked `fixture`.

## Build and verify

No JavaScript framework, package installation or bundler is required. Python 3 serves the files; Chromium/Playwright is used for verification.

Clone this repository into `<game>/_Mods/FactoryDashboard` and the API repository into the sibling `<game>/_Mods/FactoryPlannerApi`. The tracked `dist/` directory contains the application and prepared resources, so it can run directly. Regenerating assets requires the local game's `Extracted/` references; some source tests need locally generated API fixtures in `Verification/`, which are deliberately excluded from Git. Dashboard package version is recorded in version.txt independently from the sibling API version. See `Nexus/Factory Planner README.txt` for detailed installation and troubleshooting; the packaging script's historical name does not imply a Nexus upload.

```powershell
python _Mods/FactoryDashboard/tools/prepare_assets.py
python _Mods/FactoryDashboard/tools/prepare_planning.py
python _Mods/FactoryDashboard/tests/verify_dashboard.py
python _Mods/FactoryDashboard/tests/verify_objectives.py
python _Mods/FactoryDashboard/tests/verify_layout.py
python _Mods/FactoryDashboard/tests/verify_containers.py
python _Mods/FactoryDashboard/tests/verify_live_dashboard.py
```

Asset preparation copies original game artwork/fonts, the shared browser API client, and the verified catalog definitions. Planning preparation reads equipment armor traits from the same extracted definitions. Both preserve the extracted source and archived Workshop. Verification covers five views, goal creation/persistence, live speed updates, ingredient supply selection, rate edits during live refreshes, research/building inspectors, keyboard selection, disconnect/reconnect and desktop/mobile overflow. Objective checks additionally cover multiple feeds, ordered preparation, enhancement catalysts, operating costs, training returns, acceptance filters, equipment conflicts, and currency icons/precision. Live verification reads the running API without gameplay commands. Reports and visual checks live in `Verification`.


### Container final products and measured earnings

Each Container in Workshop floors and the register lists the final products at its output, following routing utilities to objectives such as Shops, export destinations, or terminal storage. Matching products sent to multiple Shops are grouped, with accepted items/second, attributed sales revenue, the total sent to objectives, and scoped container profit/deficit. Parent totals include descendants once. Recipe intermediates that are consumed by another machine inside the same Container are omitted.

These rates use API 0.1.3 cumulative event counters over up to 60 seconds of live observations. They are not recipe-capacity estimates. Till collection is not counted as a new sale. Net earnings subtract operating spend inside the Container; imported/shared input costs remain outside that scope. Unattributable external/passive objective income and unknown pre-existing buffer provenance are shown as unavailable. Legacy APIs show products and an update notice while measured values remain pending. Epoch, topology and kingdom changes or disconnects reset the window.
