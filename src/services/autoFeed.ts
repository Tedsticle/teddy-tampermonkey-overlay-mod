// src/services/autoFeed.ts
// Auto Feed: keeps the feeding trough topped up from crop inventory, per pet
// species currently out, up to a configured target count. No UI logic here.

import { Atoms, isMyInventoryAtMaxLength } from "../store/atoms";
import { PetsService } from "./pets";
import { PlayerService, type CropInventoryState, type CropItem } from "./player";
import { readAriesPath, writeAriesPath } from "../utils/localStorage";
import { toastSimple } from "../ui/toast";

export const TROUGH_CAPACITY = 9;

const PATH_CONFIG = "autoFeed.config";
const POLL_INTERVAL_MS = 2500;
const RESTOCK_RETRY_DELAY_MS = 5000;
const RESTOCK_MAX_ATTEMPTS = 2;

export type AutoFeedSpeciesConfig = {
  enabled: boolean;
  /** Assigned crop species id (must be in the pet species' diet). */
  crop: string | null;
  /** Target count to keep in the trough for this crop. */
  restockTo: number;
  /** Crop mutations that must never be pulled from inventory for this species. */
  excludeMutations: string[];
};

export type AutoFeedConfig = {
  masterEnabled: boolean;
  species: Record<string, AutoFeedSpeciesConfig>;
};

const DEFAULT_SPECIES_CONFIG: AutoFeedSpeciesConfig = {
  enabled: false,
  crop: null,
  restockTo: 0,
  excludeMutations: [],
};

let _config: AutoFeedConfig = { masterEnabled: false, species: {} };
let _configLoaded = false;

function _ensureConfigLoaded(): void {
  if (_configLoaded) return;
  _configLoaded = true;
  try {
    const obj = readAriesPath<AutoFeedConfig>(PATH_CONFIG);
    if (obj && typeof obj === "object") {
      const species: Record<string, AutoFeedSpeciesConfig> = {};
      for (const [key, raw] of Object.entries((obj as any).species || {})) {
        const v = raw as any;
        species[key] = {
          enabled: !!v?.enabled,
          crop: typeof v?.crop === "string" && v.crop ? v.crop : null,
          restockTo: Number.isFinite(v?.restockTo) ? Math.max(0, Math.floor(v.restockTo)) : 0,
          excludeMutations: Array.isArray(v?.excludeMutations)
            ? v.excludeMutations.filter((m: unknown): m is string => typeof m === "string")
            : [],
        };
      }
      _config = { masterEnabled: !!(obj as any).masterEnabled, species };
    }
  } catch {
    _config = { masterEnabled: false, species: {} };
  }
}

function _saveConfig(): void {
  try { writeAriesPath(PATH_CONFIG, _config); } catch {}
}

function _getSpeciesConfig(species: string): AutoFeedSpeciesConfig {
  _ensureConfigLoaded();
  return _config.species[species] ?? DEFAULT_SPECIES_CONFIG;
}

/* ------------------------------- Restock engine ------------------------------- */

let _started = false;
let _pollTimer: number | null = null;
let _lastTrough: CropInventoryState = null;
let _lastCropInv: CropInventoryState = null;
let _lastInventoryRaw: unknown[] = [];
let _lastInventoryMaxed = false;
let _activeSpeciesSet = new Set<string>();
const _inFlight = new Set<string>();
let _rebalanceInFlight = false;

function _countTroughByCrop(crop: string): number {
  const arr = Array.isArray(_lastTrough) ? _lastTrough : [];
  return arr.filter((it) => String((it as any)?.species || "") === crop).length;
}

/**
 * There is no dedicated "feeding trough contents" atom — the real game atom
 * list has no `myFeedingTroughItemsAtom`. Trough contents actually live
 * inside the generic inventory atom's `storages` array, under the
 * `FeedingTrough` entry (alongside PetHutch/SeedSilo). Derive from there.
 */
function _extractTroughItems(rawInventory: any): CropItem[] {
  const storages = Array.isArray(rawInventory?.storages) ? rawInventory.storages : [];
  const trough = storages.find((s: any) => String(s?.decorId || "") === "FeedingTrough");
  return Array.isArray(trough?.items) ? trough.items : [];
}

/** Pet species currently in your active slots (same source as the Instant Feed widget). */
export function extractActiveSpecies(rawSlots: unknown): Set<string> {
  const arr = Array.isArray(rawSlots) ? rawSlots : [];
  const out = new Set<string>();
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as any;
    const slot = raw?.slot && typeof raw.slot === "object" ? raw.slot : raw;
    const species = String(slot?.petSpecies ?? raw?.petSpecies ?? "").trim();
    if (species) out.add(species);
  }
  return out;
}

function _pickCropInventoryItem(crop: string, excludeMutations: string[]): CropItem | null {
  const arr = Array.isArray(_lastCropInv) ? _lastCropInv : [];
  const excludeSet = new Set(excludeMutations);
  for (const it of arr) {
    if (String((it as any)?.species || "") !== crop) continue;
    const muts: string[] = Array.isArray((it as any)?.mutations) ? (it as any).mutations : [];
    if (muts.some((m) => excludeSet.has(m))) continue;
    return it as CropItem;
  }
  return null;
}

/**
 * NOTE: the exact meaning of `toStorageIndex` for a trough insert hasn't been
 * confirmed live yet — this assumes "next free slot = current trough item
 * count" and needs verifying in-game before relying on it.
 */
async function _attemptRestock(species: string, cfg: AutoFeedSpeciesConfig): Promise<void> {
  if (!cfg.crop) return;
  const need = cfg.restockTo - _countTroughByCrop(cfg.crop);
  if (need <= 0) return;

  const item = _pickCropInventoryItem(cfg.crop, cfg.excludeMutations);
  if (!item?.id) return; // nothing eligible right now; retried on next poll

  const troughLen = Array.isArray(_lastTrough) ? _lastTrough.length : 0;
  const toIndex = Math.max(0, Math.min(TROUGH_CAPACITY - 1, troughLen));

  for (let attempt = 0; attempt < RESTOCK_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RESTOCK_RETRY_DELAY_MS));
    try {
      await PlayerService.putItemInFeedingTrough(item.id, toIndex);
      return;
    } catch {
      // retry
    }
  }
}

/**
 * NOTE: same caveat as the restock path — `toInventoryIndex` is a best-effort
 * guess (end of the current raw inventory list) and hasn't been confirmed
 * live yet.
 */
async function _retrieveOneFromTrough(item: CropItem): Promise<boolean> {
  if (!item?.id) return false;
  if (_lastInventoryMaxed) return false;
  const toIndex = Array.isArray(_lastInventoryRaw) ? _lastInventoryRaw.length : 0;
  try {
    await PlayerService.retrieveItemFromFeedingTrough(item.id, toIndex);
    return true;
  } catch {
    return false;
  }
}

/** Pulls trough items of `cfg.crop` back to inventory when the trough holds
 * more than the configured target (e.g. you lowered the threshold after it
 * was already topped up). */
async function _attemptTrim(species: string, cfg: AutoFeedSpeciesConfig): Promise<void> {
  if (!cfg.crop) return;
  let guard = 0;
  while (_countTroughByCrop(cfg.crop) > cfg.restockTo && guard++ < TROUGH_CAPACITY) {
    const arr = Array.isArray(_lastTrough) ? _lastTrough : [];
    const item = arr.find((it) => String((it as any)?.species || "") === cfg.crop) as CropItem | undefined;
    if (!item?.id) break;
    const ok = await _retrieveOneFromTrough(item);
    if (!ok) break;
    // Give the trough atom a moment to reflect the retrieval before re-reading it.
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function _tick(): Promise<void> {
  _ensureConfigLoaded();
  if (!_config.masterEnabled) return;
  for (const [species, cfg] of Object.entries(_config.species)) {
    if (!cfg.enabled || !cfg.crop || cfg.restockTo <= 0) continue;
    if (!_activeSpeciesSet.has(species)) continue; // only restock for pets currently out
    if (_inFlight.has(species)) continue;
    _inFlight.add(species);
    try {
      await _attemptRestock(species, cfg);
      await _attemptTrim(species, cfg);
    } finally {
      _inFlight.delete(species);
    }
  }
}

/**
 * Runs when your active pet species change. Reclaims trough food that no
 * currently-active+enabled species needs anymore, one unit at a time, trying
 * to top up a currently-needed crop after each reclaim. Stops immediately
 * (with an alert) if inventory is full, leaving a safe partial state.
 */
async function _rebalanceTroughForActiveSpecies(): Promise<void> {
  if (_rebalanceInFlight) return;
  _rebalanceInFlight = true;
  try {
    _ensureConfigLoaded();
    if (!_config.masterEnabled) return;

    const neededCrops = new Set<string>();
    for (const species of _activeSpeciesSet) {
      const cfg = _getSpeciesConfig(species);
      if (cfg.enabled && cfg.crop) neededCrops.add(cfg.crop);
    }

    let guard = 0;
    while (guard++ < TROUGH_CAPACITY) {
      const troughArr = Array.isArray(_lastTrough) ? _lastTrough : [];
      const orphan = troughArr.find((it) => {
        const species = String((it as any)?.species || "");
        return species && !neededCrops.has(species);
      }) as CropItem | undefined;
      if (!orphan) break;

      if (_lastInventoryMaxed) {
        try {
          await toastSimple(
            "Auto Feed",
            "Inventory is full — can't reclaim trough food from a swapped-out pet.",
            "error",
          );
        } catch {}
        break;
      }

      const ok = await _retrieveOneFromTrough(orphan);
      if (!ok) break;

      // Give the trough atom a moment to reflect the retrieval before re-reading it.
      await new Promise((r) => setTimeout(r, 400));
      await _tick(); // try to fill the freed slot with a currently-needed crop
    }
  } finally {
    _rebalanceInFlight = false;
  }
}

/* ---------------------------------- Public API --------------------------------- */

export const AutoFeedService = {
  async start(): Promise<() => void> {
    if (_started) return () => {};
    _started = true;
    _ensureConfigLoaded();

    try { _lastCropInv = await Atoms.inventory.myCropInventory.get(); } catch {}
    try {
      const rawInv = await Atoms.inventory.myInventory.get();
      _lastInventoryRaw = (rawInv as any)?.items ?? [];
      _lastTrough = _extractTroughItems(rawInv);
    } catch {}
    try { _lastInventoryMaxed = !!(await isMyInventoryAtMaxLength.get()); } catch {}
    try { _activeSpeciesSet = extractActiveSpecies(await Atoms.pets.myPrimitivePetSlots.get()); } catch {}

    let unsubCrop: (() => void) | null = null;
    let unsubInventory: (() => void) | null = null;
    let unsubMaxed: (() => void) | null = null;
    let unsubActivePets: (() => void) | null = null;
    try {
      unsubCrop = await Atoms.inventory.myCropInventory.onChange((next) => {
        _lastCropInv = next;
      });
    } catch {}
    try {
      unsubInventory = await Atoms.inventory.myInventory.onChange((next: any) => {
        _lastInventoryRaw = next?.items ?? [];
        _lastTrough = _extractTroughItems(next);
      });
    } catch {}
    try {
      unsubMaxed = await isMyInventoryAtMaxLength.onChange((next: any) => {
        _lastInventoryMaxed = !!next;
      });
    } catch {}
    try {
      unsubActivePets = await Atoms.pets.myPrimitivePetSlots.onChange((next) => {
        const nextSet = extractActiveSpecies(next);
        const changed =
          nextSet.size !== _activeSpeciesSet.size ||
          [..._activeSpeciesSet].some((s) => !nextSet.has(s));
        _activeSpeciesSet = nextSet;
        if (changed) void _rebalanceTroughForActiveSpecies();
      });
    } catch {}

    _pollTimer = window.setInterval(() => { void _tick(); }, POLL_INTERVAL_MS);
    void _tick();

    return () => {
      _started = false;
      try { unsubCrop?.(); } catch {}
      try { unsubInventory?.(); } catch {}
      try { unsubMaxed?.(); } catch {}
      try { unsubActivePets?.(); } catch {}
      if (_pollTimer != null) {
        window.clearInterval(_pollTimer);
        _pollTimer = null;
      }
    };
  },

  getConfig(): AutoFeedConfig {
    _ensureConfigLoaded();
    return { masterEnabled: _config.masterEnabled, species: { ..._config.species } };
  },

  isMasterEnabled(): boolean {
    _ensureConfigLoaded();
    return _config.masterEnabled;
  },

  setMasterEnabled(enabled: boolean): void {
    _ensureConfigLoaded();
    _config.masterEnabled = !!enabled;
    _saveConfig();
  },

  getSpeciesConfig(species: string): AutoFeedSpeciesConfig {
    return { ..._getSpeciesConfig(species) };
  },

  setSpeciesConfig(species: string, patch: Partial<AutoFeedSpeciesConfig>): AutoFeedSpeciesConfig {
    _ensureConfigLoaded();
    const cur = _getSpeciesConfig(species);
    const next: AutoFeedSpeciesConfig = {
      enabled: patch.enabled != null ? !!patch.enabled : cur.enabled,
      crop: patch.crop !== undefined ? patch.crop : cur.crop,
      restockTo:
        patch.restockTo != null && Number.isFinite(patch.restockTo)
          ? Math.max(1, Math.min(TROUGH_CAPACITY, Math.floor(patch.restockTo)))
          : cur.restockTo,
      excludeMutations: patch.excludeMutations
        ? patch.excludeMutations.filter((m): m is string => typeof m === "string")
        : cur.excludeMutations,
    };

    // Assigned crop must be in that species' actual diet.
    if (next.crop) {
      const compatibles = new Set(PetsService.getCompatibleCropsForSpecies(species));
      if (!compatibles.has(next.crop)) next.crop = null;
    }

    _config.species[species] = next;
    _saveConfig();
    return { ...next };
  },

  /** Sum of restockTo across all enabled+assigned species (for the 9-slot cap warning). */
  getConfiguredRestockTotal(excludingSpecies?: string): number {
    _ensureConfigLoaded();
    let total = 0;
    for (const [s, cfg] of Object.entries(_config.species)) {
      if (s === excludingSpecies) continue;
      if (cfg.enabled && cfg.crop) total += cfg.restockTo;
    }
    return total;
  },

  wouldExceedCap(species: string, restockTo: number): boolean {
    return this.getConfiguredRestockTotal(species) + Math.max(0, restockTo) > TROUGH_CAPACITY;
  },

  getTroughCountForCrop(crop: string): number {
    return _countTroughByCrop(crop);
  },

  /** Pet species currently in your active slots. */
  getActiveSpecies(): Set<string> {
    return new Set(_activeSpeciesSet);
  },

  isSpeciesActive(species: string): boolean {
    return _activeSpeciesSet.has(species);
  },

  async onActiveSpeciesChangeNow(cb: (active: Set<string>) => void): Promise<() => void> {
    cb(new Set(_activeSpeciesSet));
    return Atoms.pets.myPrimitivePetSlots.onChange((next: unknown) => {
      cb(extractActiveSpecies(next));
    });
  },
};
