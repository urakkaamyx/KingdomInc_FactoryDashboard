KINGDOM INC. FACTORY PLANNER - 0.1.4
External browser dashboard and read-only Factory API

REQUIREMENTS
- Kingdom Inc., Windows x64 Mono build.
- BepInEx 5.4.23.5 or newer in the 5.x series, Windows x64.
  https://github.com/BepInEx/BepInEx/releases/tag/v5.4.23.5
  Installation guide: https://docs.bepinex.dev/articles/user_guide/installation/index.html
- Python 3.9 or newer, with the python command available on PATH.
  https://www.python.org/downloads/windows/
- A modern browser. No browser extension or JavaScript package installation is needed.

MANUAL INSTALL
1. Close Kingdom Inc.
2. Install BepInEx if it is not already installed. Extract the Windows x64
   BepInEx package into the folder containing KingdomInc.exe. Run the game
   once to initialize BepInEx, then close it.
3. Extract THIS ZIP into that same game folder. Merge BepInEx and _Mods;
   replace files belonging to Factory Planner when updating.
4. Verify these paths exist directly under the game folder:
   BepInEx\plugins\KingdomFactoryApi\KingdomFactoryApi.dll
   _Mods\FactoryDashboard\start.ps1
   Start Factory Planner.cmd
   Do not leave an extra ZIP-named folder between these files and the game.
5. Start the game and load your kingdom.
6. Double-click Start Factory Planner.cmd. It starts a hidden localhost
   dashboard server and opens http://127.0.0.1:17841 in your default browser.
   You can move this browser window to a second monitor.

The API runs in the game at http://127.0.0.1:17840/api/v1.
BepInEx and Python are prerequisites, not bundled in this ZIP.
This release is packaged for manual installation. Vortex deployment has not
been tested for Kingdom Inc.

USING THE PLANNER
- Overview: live progress, currencies, profit/deficit and workshop Containers.
- Production: add a target product or objective, choose inputs and preparation
  such as outfitting and training, then Generate layout.
- Expand: show individual machines. Fullscreen: fit the generated flow view.
  Wheel to zoom, drag to pan, click a node to inspect its modifiers.
- Factory: open nested Containers and inspect placed buildings.
- Research and Resources: inspect live unlocks and shared supply quotas.
- Money always displays Gold, Silver, Copper in that order, including zeros.
  100 Copper = 1 Silver; 100 Silver = 1 Gold. Coin amounts have no decimals.
  Per-second money displays round to whole Copper; calculations retain precision.

MEASURED RATES AND LIMITS
Actual transfer, objective delivery and earnings counters require API 0.1.3,
included here. Rates need initial live samples and use up to a 60-second window.
Container net includes attributed sales minus operating costs inside that
Container and its descendants. Imported/shared production costs are not allocated.
Unknown revenue attribution is shown as unavailable rather than estimated.
Treasury net measures balance changes, including purchases and collections.

Generated layouts are manual build guides. They do not place buildings in-game.
Machine estimates assume continuous operation, using sampled speed or base speed;
productivity, byproducts, starvation and transport can change achieved output.
Manifold/Collector/Distributor routing respects their four-connection limits.

LOCAL DATA
The API observes the loaded kingdom; it does not purchase research, move buildings
or write game saves. Both servers bind to IPv4 localhost on this computer.
Plans and the latest synced snapshot are stored in your browser's local storage.
Use the same browser and address to keep your plans. This download contains no
saved kingdom, personal browser data, server logs or installed API configuration.

STOPPING, UPDATING AND UNINSTALLING
- Stop the dashboard using Stop Factory Planner.cmd. It stops only this project's
  recorded Python server. Exiting the game stops the API but not the dashboard.
- To update: stop the dashboard, close the game, extract the new package, then
  restart both and refresh the browser. Existing browser plans remain in place.
- To uninstall: stop the dashboard and close the game; remove ONLY
  BepInEx\plugins\KingdomFactoryApi and _Mods\FactoryDashboard, plus this
  package's two launcher .cmd files, README and changelog. Other plugins and
  the BepInEx loader can remain. The optional API config is
  BepInEx\config\urakka.kingdominc.factoryapi.cfg.
- Browser-local plans persist separately; clear this site's storage in your
  browser only if you also want to discard them.

TROUBLESHOOTING
- Missing Python: install Python 3, enable its PATH option, then check that
  `python --version` works in a new terminal before running the launcher again.
- Dashboard cannot connect: load a kingdom and check
  BepInEx\LogOutput.log for Factory API messages. Do not open index.html directly.
- API port 17840 busy: the plugin logs the conflict. Change its port in the config
  with the game closed, then use the dashboard's connection settings.
- Dashboard port 17841 busy: in PowerShell from the game folder run
  & .\_Mods\FactoryDashboard\start.ps1 -Port 17842
  Plans are browser-origin specific, so a new port has its own local storage.
- Server diagnostics: _Mods\FactoryDashboard\Verification\server-errors.log.
- Game patches can invalidate extracted reference data. Runtime unlocks remain
  authoritative; reference-dependent planning may need a refreshed release.

CREDITS
Mod and dashboard: Urakka.
Original artwork, icons, UI styling, fonts and game definitions originate from
Kingdom Inc. and their respective creators. All respective ownership is retained.
BepInEx, Harmony and Python are separate projects credited to their maintainers.
This is an unofficial mod and is not affiliated with the game's developer.
