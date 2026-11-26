// Emberwing Courier — bootstrap. Wires the menu buttons, starts the game
// loop, and honours ?shot=<name> for deterministic screenshot poses.

import { Game } from './game.js';
import { MISSIONS } from './config.js';

const $ = (id) => document.getElementById(id);

const game = new Game();
// Debug handle for local play-testing (headless smoke tests read flight state).
window.__emberwing = game;

// Screenshot mode: a real render of the game's own code, staged by the
// game itself (?shot=cover|runway|night|storm). No menus, HUD on.
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  document.body.classList.add('shot-mode');
  game.applyShot(shot);
  // Keep rendering a few settling frames so clouds/smoke are alive.
  let frames = 0;
  const settle = () => {
    frames++;
    if (frames < 24) {
      game.terrain.update(0.05, game.flight.pos, 1.2);
      game.renderer.render(game.scene, game.camera);
      requestAnimationFrame(settle);
    }
  };
  requestAnimationFrame(settle);
} else {
  // Normal play: build the title backdrop scene (Ember Isle at dawn).
  game.loadMission(MISSIONS[0]);
  game.flight.placeOnRunway({ x: -150, z: 1150, heading: 90, length: 620, width: 42, altitude: game.terrain.rawHeightAt(-150, 1150) + 0.6 });
  game.screen = 'title';
  game.showTitle();
  game.loop();
}

// -- Menu wiring --------------------------------------------------------------
$('btn-fly').addEventListener('click', () => {
  game.sound.ensure();
  game.sound.click();
  game.showHangar();
});
$('btn-help').addEventListener('click', () => {
  game.sound.ensure();
  game.sound.click();
  game.showHelp();
});
$('btn-help-close').addEventListener('click', () => {
  game.sound.click();
  game.showTitle();
});
$('btn-hangar-back').addEventListener('click', () => {
  game.sound.click();
  game.showTitle();
});
$('btn-hangar-next').addEventListener('click', () => {
  game.sound.click();
  game.showMissions();
});
$('btn-missions-back').addEventListener('click', () => {
  game.sound.click();
  game.showHangar();
});
$('btn-briefing-back').addEventListener('click', () => {
  game.sound.click();
  game.showMissions();
});
$('btn-briefing-fly').addEventListener('click', () => {
  game.sound.ensure();
  game.sound.click();
  game.loadMission(game.missionDef, game.aircraftSpec);
});
$('btn-pause-resume').addEventListener('click', () => {
  game.sound.click();
  game.screen = 'flying';
  game.show(null);
});
$('btn-pause-restart').addEventListener('click', () => {
  game.sound.click();
  game.loadMission(game.missionDef, game.aircraftSpec);
});
$('btn-pause-quit').addEventListener('click', () => {
  game.sound.click();
  game.showMissions();
});
$('btn-debrief-replay').addEventListener('click', () => {
  game.sound.click();
  game.loadMission(game.missionDef, game.aircraftSpec);
});
$('btn-debrief-missions').addEventListener('click', () => {
  game.sound.click();
  game.showMissions();
});
$('btn-crash-retry').addEventListener('click', () => {
  game.sound.click();
  game.loadMission(game.missionDef, game.aircraftSpec);
});
$('btn-crash-missions').addEventListener('click', () => {
  game.sound.click();
  game.showMissions();
});

// Keyboard shortcuts that work on the menus too.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && game.screen === 'title') {
    game.sound.ensure();
    game.showHangar();
  }
});
