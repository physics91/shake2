// Compare a saved AiController against the current one through ordinary inputs and restored maps.
// Node 24 reads the simulation's TypeScript directly.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { AiController } from "../src/sim/ai.ts";
import { layoutFromLevel } from "../src/sim/level.ts";
import { createMatch, step } from "../src/sim/match.ts";
import { setups, VERSUS } from "../src/sim/testing.ts";

const [baselinePath, outputPath, seedsText = "509,991", mapsText = "mizar01,block01,desert01,bella01"] = process.argv.slice(2);
if (!baselinePath || !outputPath) throw new Error("Usage: node scripts/compare-ai.mjs <baseline.ts> <output.json> [seeds] [maps]");
const baselineUrl = pathToFileURL(resolve(baselinePath));
const { AiController: Baseline } = await import(baselineUrl.href);
const seeds = seedsText.split(",").map(Number);
if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new Error("Seeds must be nonnegative integers");
const maps = mapsText.split(",");
const rules = { ...VERSUS, medalsToWin: 1 };
const maxTicks = 10_000;
const sources = ["ai.ts", "aiWorld.ts", "aiCombat.ts", "aiGoals.ts"];
const hash = (url) => createHash("sha256").update(readFileSync(url)).digest("hex");
const sourceHashes = Object.fromEntries(sources.map((file) => [file, hash(new URL(`../src/sim/${file}`, import.meta.url))]));
const games = [], samples = [];
const started = performance.now();
const eventKeys = { "bomb-placed": "bomb", "missile-fired": "missile", "bomb-thrown": "throw", "jumped": "jump" };

for (const map of maps) for (const seed of seeds) for (const newId of [1, 2]) {
  const meta = JSON.parse(readFileSync(new URL(`../public/assets/maps/${map}.json`, import.meta.url), "utf8"));
  // Each pair shares the map, RNG, clock, characters and rules; only controller seats swap.
  const state = createMatch(layoutFromLevel(map, meta), setups(2), rules, seed);
  const improved = new AiController(newId), old = new Baseline(3 - newId);
  const events = { new: { bomb: 0, missile: 0, throw: 0, jump: 0 }, old: { bomb: 0, missile: 0, throw: 0, jump: 0 } };
  while (state.tick < maxTicks && state.phase !== "match-over") {
    const start = performance.now();
    const input = improved.sample(state);
    if (state.phase === "playing") samples.push(performance.now() - start);
    step(state, { [newId]: input, [3 - newId]: old.sample(state) });
    for (const event of state.events) {
      const owner = event.owner ?? event.playerId;
      const key = eventKeys[event.type];
      if (key && (owner === 1 || owner === 2)) events[owner === newId ? "new" : "old"][key]++;
    }
  }
  const game = {
    map, seed, newId, ticks: state.tick, rounds: state.round,
    result: state.matchWinnerId === null ? "draw" : state.matchWinnerId === newId ? "win" : "loss", events,
  };
  games.push(game);
  console.log(JSON.stringify(game));
}

samples.sort((a, b) => a - b);
const result = {
  baselineSha256: hash(baselineUrl), sourceHashes,
  sourceUnchanged: sources.every((file) => sourceHashes[file] === hash(new URL(`../src/sim/${file}`, import.meta.url))),
  rules, maxTicks, maps, seeds, total: games.length,
  wins: games.filter((g) => g.result === "win").length,
  losses: games.filter((g) => g.result === "loss").length,
  draws: games.filter((g) => g.result === "draw").length,
  sampleMs: {
    n: samples.length, mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95: samples[Math.floor(samples.length * 0.95)], p99: samples[Math.floor(samples.length * 0.99)], max: samples.at(-1),
  },
  elapsedMs: performance.now() - started, games,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, games: undefined }));
