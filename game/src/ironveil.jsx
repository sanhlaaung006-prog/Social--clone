    import React, { useEffect, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { create } from "zustand";
    import { createWorld, inputState, debugStats, MAP_PRESETS, worldControl } from "./world.js";
    import { AIRCRAFT_COMPONENTS, aircraftComponentColor } from "./aircraft/aircraft-core.js";
    import { sfx } from "./audio.js";

    // === [UI: ZUSTAND_STORE] ===
    const ITEMS = {
      kx9: {
        name: "KX-9 CARBINE", type: "PRIMARY WEAPON", category: "weapon", slot: "primary",
        rarity: "FIELD GRADE", code: "WPN-09", icon: "carbine", weight: 3.4,
        desc: "Modular 5.56 platform tuned for close-quarters aggression. A proven patrol rifle with a light, deliberate recoil impulse.",
        stats: { PWR: 68, ACC: 81, CTRL: 77, MOB: 66 }
      },
      r11: {
        name: "R-11 BREACHER", type: "PRIMARY WEAPON", category: "weapon", slot: "primary",
        rarity: "ASSAULT GRADE", code: "WPN-11", icon: "shotgun", weight: 4.2,
        desc: "Door-kicking tool. The R-11 trades reach for raw stopping power at bad-breath distance. Keep the barrel level.",
        stats: { PWR: 94, ACC: 43, CTRL: 58, MOB: 49 }
      },
      dmr7: {
        name: "M-70 MARKSMAN", type: "PRIMARY WEAPON", category: "weapon", slot: "primary",
        rarity: "PRECISION GRADE", code: "WPN-70", icon: "rifle", weight: 4.8,
        desc: "Semi-auto 7.62 marksman system. Built for overwatch on the relay ridge, not for clearing rooms.",
        stats: { PWR: 87, ACC: 93, CTRL: 51, MOB: 42 }
      },
      vp70: {
        name: "VP-70 SIDEARM", type: "SECONDARY WEAPON", category: "weapon", slot: "secondary",
        rarity: "STANDARD ISSUE", code: "WPN-70S", icon: "pistol", weight: 1.1,
        desc: "Reliable 9mm sidearm for the moments you cannot afford a reload. High draw speed, low signature.",
        stats: { PWR: 41, ACC: 69, CTRL: 83, MOB: 94 }
      },
      raven: {
        name: "RAVEN HELMET", type: "HEADGEAR", category: "gear", slot: "head",
        rarity: "RECON GRADE", code: "GEAR-04", icon: "helmet", weight: 1.7,
        desc: "Lightweight recon shell with an integrated low-light display. Keeps your silhouette sharp and your comms close.",
        stats: { ARMOR: 42, SENSOR: 88, STEALTH: 74, MOB: 82 }
      },
      plate3: {
        name: "PLATE CARRIER III", type: "TORSO ARMOR", category: "gear", slot: "torso",
        rarity: "ASSAULT GRADE", code: "GEAR-07", icon: "armor", weight: 4.1,
        desc: "Level III hard plates in a low-profile carrier. Heavy enough to stop a rifle round, light enough to keep moving.",
        stats: { ARMOR: 84, SENSOR: 30, STEALTH: 48, MOB: 57 }
      },
      trauma: {
        name: "TRAUMA KIT", type: "FIELD SUPPORT", category: "gear", slot: "utility",
        rarity: "MEDICAL", code: "UTIL-02", icon: "medkit", weight: 0.8,
        desc: "Hemostatic dressing, tourniquet and a sealed chest patch. The most important item on the harness.",
        stats: { HEAL: 72, SPEED: 66, UTILITY: 91, MOB: 91 }
      },
      frag: {
        name: "M67 FRAG", type: "THROWABLE", category: "gear", slot: "utility",
        rarity: "STANDARD ISSUE", code: "UTIL-06", icon: "grenade", weight: 0.4,
        desc: "Time-fused fragmentation charge. Cook it too long and command will be writing letters to your next of kin.",
        stats: { PWR: 86, RANGE: 38, CONTROL: 44, UTILITY: 72 }
      },
      smoke: {
        name: "SMOKE CANISTER", type: "THROWABLE", category: "gear", slot: "utility",
        rarity: "TACTICAL", code: "UTIL-08", icon: "grenade", weight: 0.4,
        desc: "Screening smoke for a clean break or a covered push. The relay approach is exposed — use it wisely.",
        stats: { PWR: 22, RANGE: 41, CONTROL: 71, UTILITY: 90 }
      },
      drone: {
        name: "SPECTER DRONE", type: "RECON SUPPORT", category: "gear", slot: "utility",
        rarity: "PROTOTYPE", code: "UTIL-12", icon: "drone", weight: 1.3,
        desc: "Palm-sized recon unit with a passive thermal lens. Pipe its feed to the squad before you cross the ridge.",
        stats: { SENSOR: 97, SPEED: 78, UTILITY: 86, MOB: 84 }
      },
      ammo556: {
        name: "5.56 SABOT", type: "AMMUNITION / BOX", category: "ammo", slot: null,
        rarity: "SUPPLY", code: "AMM-556", icon: "ammo", weight: 0.6, reserveAdd: 60,
        desc: "Sixty linked 5.56 rounds. Clean-burning propellant and a tighter dispersion pattern than the standard lot.",
        stats: { STOP: 74, PENETRATION: 81, RANGE: 77, SUPPLY: 60 }
      },
      ammo9: {
        name: "9MM SUBSONIC", type: "AMMUNITION / BOX", category: "ammo", slot: null,
        rarity: "SUPPLY", code: "AMM-009", icon: "ammo", weight: 0.4, reserveAdd: 40,
        desc: "Forty subsonic 9mm rounds. Reduced report — the way sidearms were meant to sound in a dark corridor.",
        stats: { STOP: 48, PENETRATION: 51, RANGE: 44, SUPPLY: 40 }
      }
    };

    // Per-gun handling used by thumb-first slot swapping + ADS. Reserve
    // ammunition stays one shared pool (existing ammo boxes feed it), while
    // each carried slot remembers its own loaded magazine.
    const WEAPON_PROFILES = {
      kx9: { magazineSize: 30, adsFactor: 0.58, spread: 1, swapSeconds: 0.42 },
      r11: { magazineSize: 6, adsFactor: 0.68, spread: 2.4, swapSeconds: 0.5 },
      dmr7: { magazineSize: 10, adsFactor: 0.42, spread: 0.45, swapSeconds: 0.55 },
      vp70: { magazineSize: 15, adsFactor: 0.62, spread: 0.75, swapSeconds: 0.32 },
    };
    const weaponProfileFor = (id) => WEAPON_PROFILES[id] || { magazineSize: 30, adsFactor: 0.58, spread: 1, swapSeconds: 0.45 };
    const syncWorldWeapon = (slot, id) => {
      const profile = weaponProfileFor(id);
      inputState.activeWeaponSlot = slot;
      inputState.weaponId = id || "kx9";
      inputState.weaponAdsFactor = profile.adsFactor;
      inputState.weaponSpread = profile.spread;
    };
    let weaponSwapReadyAt = 0; // wall-clock gate while the draw animation runs

    const EQUIP_SLOTS = [
      { key: "primary", label: "PRIMARY", code: "01" },
      { key: "secondary", label: "SIDEARM", code: "02" },
      { key: "head", label: "HEADGEAR", code: "03" },
      { key: "torso", label: "CARRIER", code: "04" },
      { key: "utility", label: "UTILITY", code: "05" }
    ];

    const FACTION_A = "VANGUARD INITIATIVE";
    const FACTION_B = "CINDER SYNDICATE";
    const INVENTORY_SIZE = 20;

    const makeInventory = () => {
      const entries = [
        ["kx9", 1], ["vp70", 1], ["raven", 1], ["plate3", 1], ["trauma", 1],
        ["r11", 1], ["dmr7", 1], ["ammo556", 3], ["ammo9", 4], ["frag", 2],
        ["smoke", 2], ["drone", 1]
      ];
      return Array.from({ length: INVENTORY_SIZE }, (_, index) => {
        const entry = entries[index];
        return entry ? { id: entry[0], qty: entry[1] } : null;
      });
    };

    let noticeSequence = 0;

    // High-frequency HUD telemetry deliberately bypasses Zustand/React.
    // world.js calls these writers only when an integer HUD value changes;
    // the mounted HUD components register their DOM nodes once, after
    // which heading/objective/range updates are direct text writes.
    const COMPASS_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const COMPASS_BEARINGS = [
      { label: "W", left: 7, major: true },
      { label: "NW", left: 22, minor: true },
      { label: "N", left: 40, major: true },
      { label: "NE", left: 55, active: true },
      { label: "E", left: 70, major: true },
      { label: "SE", left: 82, minor: true },
      { label: "S", left: 94, major: true }
    ];
    const hudTelemetry = { heading: 34, objectiveDistance: 264, objectiveBearing: 34 };
    const hudDom = { compass: null, heading: null, direction: null, objective: null, objectiveState: null, range: null };
    const setHudText = (node, text) => {
      if (node && node.textContent !== text) node.textContent = text;
    };
    function writeHeadingDom(deg) {
      hudTelemetry.heading = deg;
      const direction = COMPASS_DIRECTIONS[Math.round(deg / 45) % 8];
      setHudText(hudDom.heading, `HDG ${String(deg).padStart(3, "0")}°`);
      setHudText(hudDom.direction, direction);
      if (hudDom.compass) hudDom.compass.setAttribute("aria-label", `Compass heading ${deg} degrees ${direction}`);
    }
    function writeObjectiveDom(dist, bearing) {
      hudTelemetry.objectiveDistance = dist;
      hudTelemetry.objectiveBearing = bearing;
      setHudText(hudDom.objective, `${dist} M / ${String(bearing).padStart(3, "0")}°`);
      setHudText(hudDom.objectiveState, dist <= 16 ? "AT OBJECTIVE" : "HOLDING POSITION");
      setHudText(hudDom.range, `ENGAGE / ${dist}M`);
    }

    const getInitialMapMode = () => {
      try {
        return new URLSearchParams(window.location.search).get("map") === "br" ? "br" : "survival";
      } catch (e) {
        return "survival";
      }
    };

    const gameStore = create((set, get) => ({
      // Core player state consumed by isolated HUD selectors.
      health: 74,
      maxHealth: 100,
      ammo: 30,
      reserveAmmo: 120,
      magazineSize: 30,
      activeWeaponSlot: "primary", // which carried gun is in the hands (thumb-slot swap)
      weaponAmmo: { primary: 30, secondary: 15 }, // loaded rounds remembered per slot
      inventory: makeInventory(),
      isMenuOpen: true,
      mapMode: getInitialMapMode(),
      isOutOfBounds: false,
      // F3 perf/debug overlay is OFF by default on a mobile HUD. One shared
      // store flag drives the F3 key, the HUD chip, the Settings toggle and
      // the overlay's own close button, so they can never disagree.
      showDebug: false,

      // Session flow: the game boots to the title / start screen and only
      // enters the field when the operator hits START (see StartScreen).
      hasStarted: false,
      isDead: false,
      deathReason: "",

      // Interface / loadout state.
      screen: "title",
      equipped: { head: "raven", torso: "plate3", primary: "kx9", secondary: "vp70", utility: "trauma" },
      faction: FACTION_A,
      defected: false,
      notice: null,
      shots: 0,

      notify: (text, tone = "default") => {
        noticeSequence += 1;
        set({ notice: { id: noticeSequence, text, tone } });
      },
      clearNotice: (id) => set((state) => (state.notice && state.notice.id === id ? { notice: null } : {})),

      setMapMode: (mapMode) => {
        if (!MAP_PRESETS[mapMode]) return;
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("map", mapMode);
          window.history.replaceState(null, "", url);
        } catch (e) { /* URL sync is best-effort */ }
        set({ mapMode, isOutOfBounds: false });
        get().notify(mapMode === "br" ? "MAP PRESET // BATTLE ROYALE 2x2 KM" : "MAP PRESET // SURVIVAL 4x4 KM");
      },
      applyBoundaryDamage: (amount) => {
        set((state) => ({ health: Math.max(0, state.health - amount) }));
      },
      applyDamage: (amount, reason = "DAMAGE") => {
        const state = get();
        if (state.isDead || !(amount > 0)) return;
        const health = Math.max(0, state.health - amount);
        set({ health, ...(health <= 0 ? { isDead: true, deathReason: reason } : {}) });
        if (health <= 0) get().notify(`OPERATOR DOWN // ${reason}`, "danger");
      },
      killPlayer: (reason = "OPERATOR DOWN") => {
        if (get().isDead) return;
        set({ health: 0, isDead: true, deathReason: reason });
        get().notify(`OPERATOR DOWN // ${reason}`, "danger");
      },
      respawnPlayer: () => {
        debugStats.playerDead = 0;
        debugStats.deathReason = "";
        inputState.jetAction = null;
        inputState.aircraftGunHeld = false;
        inputState.aircraftMissileLaunch = false;
        inputState.firing = false;
        worldControl.resetAircraft = true;
        worldControl.teleport = { x: 0, z: 0, heading: 0 };
        set({ health: 74, isDead: false, deathReason: "", isMenuOpen: false, screen: "main", hasStarted: true });
        get().notify("REDEPLOYED // WARTHOG REPAIRED AT X18 Z0");
      },

      startGame: () => {
        debugStats.playerDead = 0;
        set({ hasStarted: true, isMenuOpen: false, screen: "main", isDead: false, deathReason: "" });
        get().notify("DEPLOYED // SECURE THE RELAY STATION");
      },
      quitToTitle: () => set({ hasStarted: false, isMenuOpen: true, screen: "title", isDead: false, deathReason: "" }),
      // "Home" is the pause menu in the field, the title screen before deployment.
      goHome: () => set((state) => ({ isMenuOpen: true, screen: state.hasStarted ? "main" : "title" })),

      toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen, screen: "main" })),
      openMenu: () => set({ isMenuOpen: true, screen: "main" }),
      openScreen: (screen) => set({ isMenuOpen: true, screen }),
      resume: () => set({ isMenuOpen: false }),
      setShowDebug: (showDebug) => set({ showDebug: !!showDebug }),
      toggleDebug: () => set((state) => ({ showDebug: !state.showDebug })),
      handleEscape: () => {
        const state = get();
        if (!state.hasStarted) {
          // Pre-deployment: Escape steps back to the title screen, never into the field.
          if (state.screen !== "title") set({ isMenuOpen: true, screen: "title" });
          return;
        }
        if (!state.isMenuOpen) set({ isMenuOpen: true, screen: "main" });
        else if (state.screen !== "main") set({ screen: "main" });
        else set({ isMenuOpen: false });
      },

      fire: () => {
        const state = get();
        if (state.isMenuOpen) return;
        if (performance.now() < weaponSwapReadyAt) return; // gun still coming up
        if (!state.equipped[state.activeWeaponSlot]) {
          get().notify("NO WEAPON IN HAND // TAP A GUN SLOT", "danger");
          return;
        }
        if (state.ammo > 0) {
          set((current) => {
            const nextAmmo = current.ammo - 1;
            return {
              ammo: nextAmmo,
              weaponAmmo: { ...current.weaponAmmo, [current.activeWeaponSlot]: nextAmmo },
              shots: current.shots + 1,
            };
          });
        } else if (state.reserveAmmo > 0) {
          get().notify("MAGAZINE EMPTY // TAP RLD OR SWAP GUNS", "danger");
        } else {
          get().notify("NO AMMUNITION // SCAVENGE THE FIELD", "danger");
        }
      },
      // PUBG-style thumb swap: tap the carried gun you want and it comes
      // into the hands with its own remembered magazine + draw animation.
      swapWeapon: (slot) => {
        const state = get();
        if (state.isMenuOpen || !state.hasStarted) return;
        if (slot !== "primary" && slot !== "secondary") return;
        const itemId = state.equipped[slot];
        if (!itemId || !ITEMS[itemId]) {
          get().notify("WEAPON SLOT EMPTY // EQUIP A GUN FIRST", "danger");
          return;
        }
        if (slot === state.activeWeaponSlot) return;
        if (performance.now() < weaponSwapReadyAt) return;
        const profile = weaponProfileFor(itemId);
        const loaded = Math.max(0, Math.min(profile.magazineSize, state.weaponAmmo[slot] == null ? profile.magazineSize : state.weaponAmmo[slot]));
        weaponSwapReadyAt = performance.now() + profile.swapSeconds * 1000;
        inputState.ads = false;
        inputState.firing = false;
        inputState.weaponSwap = { slot, itemId, duration: profile.swapSeconds };
        syncWorldWeapon(slot, itemId);
        set({
          activeWeaponSlot: slot,
          ammo: loaded,
          magazineSize: profile.magazineSize,
          weaponAmmo: { ...state.weaponAmmo, [slot]: loaded },
        });
        get().notify(`${ITEMS[itemId].name} // IN HAND`);
      },
      reload: () => {
        const state = get();
        if (state.isMenuOpen) return;
        if (performance.now() < weaponSwapReadyAt) return; // finish the draw first
        if (state.ammo >= state.magazineSize) {
          get().notify("MAGAZINE FULL // WEAPON NOMINAL");
          return;
        }
        if (state.reserveAmmo <= 0) {
          get().notify("NO RESERVE AMMUNITION", "danger");
          return;
        }
        const load = Math.min(state.magazineSize - state.ammo, state.reserveAmmo);
        set({
          ammo: state.ammo + load,
          reserveAmmo: state.reserveAmmo - load,
          weaponAmmo: { ...state.weaponAmmo, [state.activeWeaponSlot]: state.ammo + load },
        });
        get().notify(`RELOADED // ${load} ROUNDS`);
      },
      // Stamina consumables share one boost channel into the world sim.
      // Soda/stimulant items join later and only need to call this.
      boostStamina: (kind = "medicine", opts = {}) => {
        const presets = {
          soda: { amount: 30, duration: 8, regen: 9, powerFloor: 0.45, label: "SODA" },
          stimulant: { amount: 45, duration: 12, regen: 7, powerFloor: 0.65, label: "STIMULANT" },
          medicine: { amount: 35, duration: 6, regen: 6, powerFloor: 0.35, label: "MEDICINE" },
        };
        const boost = { ...(presets[kind] || presets.medicine), ...opts };
        inputState.staminaBoost = boost;
        if (!opts.silent) get().notify(`${boost.label} // STAMINA BOOST ONLINE`);
      },
      heal: (amount = 18) => {
        const state = get();
        if (state.isDead) return;
        if (state.health >= state.maxHealth) {
          get().boostStamina("medicine");
          return;
        }
        set({ health: Math.min(state.maxHealth, state.health + amount) });
        get().boostStamina("medicine", { silent: true });
        get().notify(`TRAUMA KIT APPLIED // +${Math.min(amount, state.maxHealth - state.health)} VITALS + STAMINA`);
      },

      equipItem: (id) => {
        const item = ITEMS[id];
        if (!item) return;
        if (!item.slot) {
          get().notify("ITEM CANNOT BE EQUIPPED // CHECK SLOT", "danger");
          return;
        }
        if (item.slot === "primary" || item.slot === "secondary") {
          const profile = weaponProfileFor(id);
          const isActive = get().activeWeaponSlot === item.slot;
          if (isActive) syncWorldWeapon(item.slot, id);
          set((state) => ({
            equipped: { ...state.equipped, [item.slot]: id },
            weaponAmmo: { ...state.weaponAmmo, [item.slot]: profile.magazineSize },
            ...(isActive ? { ammo: profile.magazineSize, magazineSize: profile.magazineSize } : {}),
          }));
        } else {
          set((state) => ({ equipped: { ...state.equipped, [item.slot]: id } }));
        }
        get().notify(`${item.name} // EQUIPPED TO ${item.slot.toUpperCase()}`);
      },
      unequipSlot: (slot) => {
        if (!slot) return;
        const state = get();
        const current = state.equipped[slot];
        if ((slot === "primary" || slot === "secondary") && state.activeWeaponSlot === slot) {
          const other = slot === "primary" ? "secondary" : "primary";
          const otherId = state.equipped[other];
          if (otherId) {
            const profile = weaponProfileFor(otherId);
            const loaded = Math.max(0, Math.min(profile.magazineSize, state.weaponAmmo[other] == null ? profile.magazineSize : state.weaponAmmo[other]));
            syncWorldWeapon(other, otherId);
            set((currentState) => ({
              equipped: { ...currentState.equipped, [slot]: null },
              activeWeaponSlot: other,
              ammo: loaded,
              magazineSize: profile.magazineSize,
              weaponAmmo: { ...currentState.weaponAmmo, [other]: loaded },
            }));
          } else {
            set((currentState) => ({
              equipped: { ...currentState.equipped, [slot]: null },
              ammo: 0,
              magazineSize: 0,
            }));
          }
        } else {
          set((currentState) => ({ equipped: { ...currentState.equipped, [slot]: null } }));
        }
        if (current) get().notify("ITEM RELEASED TO STASH");
      },
      loadAmmo: (id) => {
        const item = ITEMS[id];
        if (!item || !item.reserveAdd) return;
        const entry = get().inventory.find((slot) => slot && slot.id === id);
        if (!entry) return;
        const nextInventory = get().inventory.map((slot) => {
          if (!slot || slot.id !== id) return slot;
          return slot.qty > 1 ? { ...slot, qty: slot.qty - 1 } : null;
        });
        set((state) => ({
          inventory: nextInventory,
          reserveAmmo: Math.min(999, state.reserveAmmo + item.reserveAdd)
        }));
        get().notify(`RESERVE REPLENISHED // +${item.reserveAdd} ROUNDS`);
      },
      sortInventory: () => {
        const order = { weapon: 0, ammo: 1, gear: 2 };
        const filled = get().inventory.filter(Boolean).slice().sort((a, b) => {
          const categoryOrder = order[ITEMS[a.id].category] - order[ITEMS[b.id].category];
          return categoryOrder || ITEMS[a.id].name.localeCompare(ITEMS[b.id].name);
        });
        const inventory = [...filled, ...Array(Math.max(0, INVENTORY_SIZE - filled.length)).fill(null)];
        set({ inventory });
        get().notify("STASH AUTO-SORTED // ALL CHANNELS NOMINAL");
      },
      defectFaction: () => {
        const next = get().faction === FACTION_A ? FACTION_B : FACTION_A;
        set({ faction: next, defected: next === FACTION_B });
        get().notify(`FACTION TRANSFER // ${next}`, next === FACTION_B ? "danger" : "default");
      }
    }));

    // A thin, selector-scoped bridge: React subscribes to Zustand directly, so
    // HUD leaves never depend on the Three.js render loop or parent props.
    const useGameStore = (selector) => React.useSyncExternalStore(
      gameStore.subscribe,
      () => selector(gameStore.getState()),
      () => selector(gameStore.getState())
    );
    useGameStore.getState = gameStore.getState;
    useGameStore.setState = gameStore.setState;
    useGameStore.subscribe = gameStore.subscribe;

    // === [UI: HUD_COMPONENTS] ===
    const FactionCode = React.memo(function FactionCode() {
      const faction = useGameStore((state) => state.faction);
      return <>{faction === FACTION_A ? "VANGUARD" : "CINDER"}</>;
    });

    // === [WORLD: THREE_TERRAIN / REACT BRIDGE] ===
    // Perf/debug overlay (top-left). Shared ON/OFF state: F3/backtick, the
    // HUD "F3" chip, Settings > Interface, and the header button below all
    // flip the same store flag. Reads mutable debugStats on a 4Hz tick so
    // the render loop never touches React; the tick stops while hidden.
    function DebugOverlay() {
      const open = useGameStore((state) => state.showDebug);
      const toggleDebug = useGameStore((state) => state.toggleDebug);
      const setShowDebug = useGameStore((state) => state.setShowDebug);
      const [, setTick] = useState(0);
      useEffect(() => {
        const onKey = (e) => {
          if (e.code === "Backquote" || e.code === "F3") {
            e.preventDefault();
            toggleDebug();
          }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [toggleDebug]);
      useEffect(() => {
        if (!open) return undefined;
        const id = setInterval(() => setTick((t) => t + 1), 250);
        return () => clearInterval(id);
      }, [open]);
      if (!open) return null;
      const d = debugStats;
      const heap =
        typeof performance !== "undefined" && performance.memory
          ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + " MB"
          : "--";
      const tod = ((d.cycle * 24 + 6) % 24).toFixed(1).padStart(4, "0") + "H";
      const rows = [
        ["FPS", d.fps.toFixed(1)],
        ["FRAME", d.frameMs.toFixed(2) + " MS"],
        ["DRAW CALLS", d.calls],
        ["TRIANGLES", d.tris.toLocaleString()],
        ["POINTS", d.points.toLocaleString()],
        ["LINES", d.lines],
        ["GEOMETRIES", d.geometries],
        ["TEXTURES", d.textures],
        ["PROGRAMS", d.programs],
        ["MAP", (MAP_PRESETS[d.mapMode]?.label || d.mapMode) + " " + d.mapSizeM + "M"],
        ["CHUNKS", d.chunksVisible + " VIS / " + d.chunksLoaded + "/" + d.chunksTotal],
        ["TERRAIN LOD", d.lod96 + "/" + d.lod48 + "/" + d.lod24],
        ["TREE LOD F/M/I", (d.treeLodFull || 0) + "/" + (d.treeLodMid || 0) + "/" + (d.treeLodFar || 0)],
        ["CHUNK BUILD", d.chunkBuildMs.toFixed(1) + " MS MAX"],
        ["PHYSICS", (d.physicsCore || "JS") + " KINEMATIC"],
        ["CPU MS", "U " + (d.cpuUpdateMs || 0).toFixed(1) + " R " + (d.cpuRenderMs || 0).toFixed(1) + " T " + (d.cpuFrameMs || 0).toFixed(1)],
        ["TERRAIN CORE", d.terrainCore + (d.terrainCore === "RUST" ? " WASM" : "") + " " + d.rustChunks],
        ["RUST SYS", "MESH " + (d.rustMeshes || 0) + " SCAT " + (d.rustScatterBatches || 0) + " AI " + (d.rustAiBatches || 0) + " SKY " + (d.rustSky ? "LUT" : "JS")],
        ["WORKER", (d.workerCore || "OFF") + " CH " + (d.workerChunks || 0) + " SC " + (d.workerScatterBatches || 0) + " AI " + (d.workerAiBatches || 0) + " Q " + (d.workerPending || 0)],
        ["MOVE", (d.grounded ? "GND" : "AIR") + " " + d.speed.toFixed(1) + " M/S VY " + d.vy.toFixed(1)],
        ["SEASON", d.season + " D" + d.seasonDay + "/10"],
        ["WEATHER", d.weather + " " + Math.round(d.weatherBlend * 100) + "%"],
        ["AI LOS", Math.round(d.aiLosM) + "M ENG " + d.dronesEngaged + "/6"],
        ["FOG EXP2", d.fogDensity.toFixed(4)],
        ["OUT OF BOUNDS", d.outOfBounds ? "YES -" + d.boundaryDamage + "/S" : "NO"],
        ["SHADOW MAPS", d.shadowMapsFrozen ? "FROZEN/OFF" : "LIVE"],
        ["SCATTER <=35M", d.cullNear],
        ["GROUND <=35M", d.grass + "G " + d.pebbles + "P " + d.blobShadows + "B"],
        ["TREES <=150M", d.cullMid],
        ["SAFETY", "R " + (d.safetyReports || 0) + " RUST " + (d.safetyRustReports || 0) + " RESCUE " + (d.safetyRescues || 0)],
        ["STAMINA/SPRINT", Math.round(d.stamina || 0) + " FX " + (d.sprintEffect || 0).toFixed(2) + (d.staminaBoostT > 0 ? " BOOST " + d.staminaBoostT + "S" : "")],
        ["FOV", (d.fov || 71).toFixed(1) + " DEG"],
        ["ADS/SCOPE", (d.adsBlend || 0).toFixed(2) + " -> " + (d.adsFov || 0).toFixed(1) + " DEG"],
        ["WEAPON/POSE", (d.weaponId || "kx9") + " F" + (d.firePose || 0).toFixed(2) + " YAW " + (d.gunYawDeg || 0).toFixed(1)],
        ["COORD X/Z/Y", Math.round(d.playerX || 0) + " / " + Math.round(d.playerZ || 0) + " / " + Math.round(d.playerY || 0) + " M"],
        ["WARTHOG", (d.jetOccupied ? "SEATED " : d.jetNear ? "NEAR " : "PARKED ") + (d.jetSpeedKmh || 0) + " KM/H ALT " + (d.jetAltitudeM || 0) + " THR " + (d.jetThrottlePct || 0) + "%"],
        ["CINEMATIC", d.cinematicActive ? "OPENING" : "OFF" + (d.introCinematicPlayed ? " (PLAYED)" : "")],
        ["WADE/SPLASH", (d.wadeDepth || 0).toFixed(2) + "M / " + (d.splashBursts || 0)],
        ["GROUNDED OBJECTS", (d.groundedObjects || 0) + " FIX " + (d.groundingCorrections || 0)],
        ["CULLED >150M", d.cullFar],
        ["DRONES VIS", d.dronesVisible + "/6"],
        ["SIM TIME", d.simSeconds.toFixed(1) + " S"],
        ["TRAVEL", d.travelM.toFixed(0) + " M"],
        ["CANVAS", d.width + "x" + d.height + " CSS " + (d.cssWidth || 0) + "x" + (d.cssHeight || 0)],
        ["DPR", ((d.dpr || window.devicePixelRatio || 1).toFixed(2)) + " NATIVE " + ((d.nativeDpr || window.devicePixelRatio || 1).toFixed(2))],
        ["JS HEAP", heap],
        ["TIME OF DAY", tod],
        ["CAM X/Z", Math.round(d.px) + " / " + Math.round(d.pz)],
      ];
      return (
        <div className="debug-overlay">
          <div className="dbg-head">
            <span>DEBUG // PERF [F3]</span>
            <button type="button" className="dbg-toggle" onClick={() => setShowDebug(false)} aria-label="Turn F3 debug overlay off">F3 · ON</button>
          </div>
          {rows.map(([k, v]) => (
            <div className="dbg-row" key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      );
    }

    const WorldScene = React.memo(function WorldScene() {
      const canvasRef = React.useRef(null);
      const apiRef = React.useRef(null);
      const hasStarted = useGameStore((state) => state.hasStarted);
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      const isDead = useGameStore((state) => state.isDead);
      const mapMode = useGameStore((state) => state.mapMode);

      useEffect(() => {
        const api = createWorld(canvasRef.current, {
          onHeading: writeHeadingDom,
          onObjective: writeObjectiveDom,
          onDroneDown: () => {
            sfx.droneDown();
            gameStore.getState().notify("HOSTILE DRONE DOWN // SECTOR SWEEP +1");
          },
          onStep: (inWater, opts) => sfx.step(!!inWater, opts || {}),
          onLand: () => sfx.land(),
          onSplash: (intensity) => sfx.splash(intensity || 1),
          onAmbience: (a) => sfx.setAmbience(a),
          onOutOfBoundsChange: (active) => {
            gameStore.setState({ isOutOfBounds: active });
            gameStore.getState().notify(
              active ? "RETURN TO THE COMBAT ZONE" : "COMBAT ZONE // IN BOUNDS",
              active ? "danger" : "default"
            );
          },
          onBoundaryDamage: (amount) => gameStore.getState().applyBoundaryDamage(amount),
          onPlayerDamage: (amount, reason) => gameStore.getState().applyDamage(amount, reason),
          onPlayerKilled: (reason) => gameStore.getState().killPlayer(reason),
          onEngine: (engine) => sfx.setEngine(engine),
          onExplosion: (size) => sfx.explosion(size || 1),
          onAircraftCannon: () => sfx.aircraftCannon(),
          onMissileLaunch: (message) => {
            sfx.missileLaunch();
            gameStore.getState().notify(message || "MISSILE AWAY");
          },
          onAircraftHit: (result, source) => {
            sfx.aircraftHit();
            if (result && result.destroyedNow) {
              gameStore.getState().notify(`${result.label} DESTROYED // ${String(source || "damage").toUpperCase()}`, "danger");
            }
          },
          onAircraftAdvisory: (advisory) => {
            if (!advisory) return;
            sfx.warning(advisory.level === "warning");
            if (advisory.level === "warning") gameStore.getState().notify(advisory.text, "danger");
          },
          onEject: () => {
            sfx.eject();
            gameStore.getState().notify("EJECTED // SEAT CLEAR OF THE AIRFRAME", "danger");
          },
          onParachute: () => gameStore.getState().notify("PARACHUTE DEPLOYED // STEER WITH DRAG"),
        }, { mapPreset: mapMode });
        apiRef.current = api;
        const unsubscribe = gameStore.subscribe((state, prev) => {
          if (state.shots > prev.shots) api.shoot();
          // A slot swap can raise the displayed magazine without being a reload.
          const sameGunInHand = state.activeWeaponSlot === prev.activeWeaponSlot
            && state.equipped[state.activeWeaponSlot] === prev.equipped[prev.activeWeaponSlot];
          if (state.ammo > prev.ammo && sameGunInHand && api.reload) api.reload();
        });
        return () => { unsubscribe(); api.dispose(); apiRef.current = null; };
      }, [mapMode]);

      useEffect(() => {
        if (apiRef.current) apiRef.current.setPlaying(hasStarted && !isMenuOpen && !isDead);
      }, [hasStarted, isMenuOpen, isDead, mapMode]);

      return (
        <div className="world" aria-hidden="true">
          <canvas ref={canvasRef} tabIndex={-1} />
          <div className="world-grade" />
        </div>
      );
    });

    function HudWeaponGlyph() {
      return (
        <svg viewBox="0 0 32 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
          <path d="M2 7h18l3-2h5l2 2v2h-5l-3 2H10l-2 3H5l1-5H2V7Z" />
          <path d="M10 11v3M20 7v-2h5" opacity=".65" />
          <circle cx="12" cy="9" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    }

    const Vitals = React.memo(function Vitals() {
      const health = useGameStore((state) => state.health);
      const maxHealth = useGameStore((state) => state.maxHealth);
      const torso = useGameStore((state) => state.equipped.torso);
      const heal = useGameStore((state) => state.heal);
      const staminaFillRef = React.useRef(null);
      const staminaTextRef = React.useRef(null);
      const ratio = Math.max(0, Math.min(1, health / maxHealth));
      const protection = Math.max(0, Math.min(100, (ITEMS[torso]?.stats?.ARMOR) || 0));

      // Stamina is simulated by world.js every frame; paint it directly
      // to the stripe instead of re-rendering React at 60Hz.
      useEffect(() => {
        let raf = 0;
        let last = -1;
        const paint = () => {
          const value = Math.max(0, Math.min(100, Math.round(debugStats.stamina || 0)));
          if (value !== last) {
            last = value;
            if (staminaFillRef.current) staminaFillRef.current.style.width = `${value}%`;
            if (staminaTextRef.current) staminaTextRef.current.textContent = String(value);
          }
          raf = requestAnimationFrame(paint);
        };
        paint();
        return () => cancelAnimationFrame(raf);
      }, []);

      return (
        <section className="vitals-stripes" aria-label="Operator vitals">
          <div className="vital-row is-health">
            <span className="vital-label">HP</span>
            <div className="vital-track" role="progressbar" aria-valuemin="0" aria-valuemax={maxHealth} aria-valuenow={health} aria-label={`Health ${health} of ${maxHealth}`}>
              <div className="vital-fill" style={{ width: `${ratio * 100}%` }} />
            </div>
            <b>{health}</b>
            <button className="med-btn" onClick={() => heal(18)} aria-label="Apply trauma kit and restore health">+</button>
          </div>
          <div className="vital-row is-stamina">
            <span className="vital-label">ST</span>
            <div className="vital-track" aria-hidden="true"><div ref={staminaFillRef} className="vital-fill" style={{ width: "100%" }} /></div>
            <b ref={staminaTextRef}>100</b>
          </div>
          <div className="vital-row is-armor">
            <span className="vital-label">AR</span>
            <div className="vital-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={protection} aria-label={`Protection ${protection} of 100`}>
              <div className="vital-fill" style={{ width: `${protection}%` }} />
            </div>
            <b>{protection}</b>
          </div>
        </section>
      );
    });

    const WeaponLine = React.memo(function WeaponLine() {
      const primary = useGameStore((state) => state.equipped.primary);
      const item = ITEMS[primary] || ITEMS.kx9;
      return (
        <span className="weapon-line">
          <HudWeaponGlyph />
          {item.name}
        </span>
      );
    });

    const AmmoMag = React.memo(function AmmoMag() {
      const nodeRef = React.useRef(null);
      const initialAmmo = gameStore.getState().ammo;
      useEffect(() => {
        const paint = (ammo) => {
          const node = nodeRef.current;
          if (!node) return;
          node.textContent = String(ammo).padStart(2, "0");
          node.className = `ammo-mag ${ammo <= 8 ? "is-low" : ""}`;
          node.setAttribute("aria-label", `${ammo} rounds in magazine`);
        };
        paint(gameStore.getState().ammo);
        return gameStore.subscribe((state, prev) => {
          if (state.ammo !== prev.ammo) paint(state.ammo);
        });
      }, []);
      return <span ref={nodeRef} className={`ammo-mag ${initialAmmo <= 8 ? "is-low" : ""}`} aria-label={`${initialAmmo} rounds in magazine`}>{String(initialAmmo).padStart(2, "0")}</span>;
    });

    const AmmoReserve = React.memo(function AmmoReserve() {
      const nodeRef = React.useRef(null);
      const initialReserve = gameStore.getState().reserveAmmo;
      useEffect(() => {
        const paint = (reserveAmmo) => {
          const node = nodeRef.current;
          if (!node) return;
          node.textContent = String(reserveAmmo);
          node.className = `ammo-reserve ${reserveAmmo === 0 ? "is-empty" : ""}`;
          node.setAttribute("aria-label", `${reserveAmmo} reserve rounds`);
        };
        paint(gameStore.getState().reserveAmmo);
        return gameStore.subscribe((state, prev) => {
          if (state.reserveAmmo !== prev.reserveAmmo) paint(state.reserveAmmo);
        });
      }, []);
      return <span ref={nodeRef} className={`ammo-reserve ${initialReserve === 0 ? "is-empty" : ""}`} aria-label={`${initialReserve} reserve rounds`}>{initialReserve}</span>;
    });

    const AmmoPips = React.memo(function AmmoPips() {
      const nodeRef = React.useRef(null);
      const initialAmmo = gameStore.getState().ammo;
      useEffect(() => {
        const paint = (ammo) => {
          const node = nodeRef.current;
          if (!node) return;
          const low = ammo <= 8;
          const children = node.children;
          for (let index = 0; index < children.length; index++) {
            children[index].className = index < ammo ? (low ? "is-live is-low" : "is-live") : "";
          }
        };
        paint(gameStore.getState().ammo);
        return gameStore.subscribe((state, prev) => {
          if (state.ammo !== prev.ammo) paint(state.ammo);
        });
      }, []);
      const low = initialAmmo <= 8;
      return (
        <div ref={nodeRef} className="ammo-pips" aria-hidden="true">
          {Array.from({ length: 30 }, (_, index) => (
            <i key={index} className={index < initialAmmo ? (low ? "is-live is-low" : "is-live") : ""} />
          ))}
        </div>
      );
    });

    const ReloadButton = React.memo(function ReloadButton() {
      const reload = useGameStore((state) => state.reload);
      return (
        <button className="reload-btn" onClick={reload} aria-label="Reload weapon">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" width="8" height="8">
            <path d="M10 5.5A4 4 0 1 1 8.6 2.2M10 1v4.5H5.5" />
          </svg>
          RELOAD <span aria-hidden="true">[R]</span>
        </button>
      );
    });

    // Thumb-first gun swapping (PUBG-style): tap the gun you want and it is
    // drawn into the hands. Tapping the gun already in hand does nothing —
    // reloading lives on the right-side RLD button / R key only.
    const WeaponSlots = React.memo(function WeaponSlots() {
      const primary = useGameStore((state) => state.equipped.primary);
      const secondary = useGameStore((state) => state.equipped.secondary);
      const activeWeaponSlot = useGameStore((state) => state.activeWeaponSlot);
      const weaponAmmo = useGameStore((state) => state.weaponAmmo);
      const swapWeapon = useGameStore((state) => state.swapWeapon);
      const slots = [
        { key: "1", slot: "primary", item: ITEMS[primary], itemId: primary },
        { key: "2", slot: "secondary", item: ITEMS[secondary], itemId: secondary },
      ].map((slot) => ({ ...slot, active: activeWeaponSlot === slot.slot }));
      const draw = (slot) => (event) => {
        event.preventDefault();
        swapWeapon(slot);
      };
      return (
        <section className="weapon-slots" aria-label="Weapon slots. Tap a gun to draw it.">
          {slots.map((slot) => slot.item ? (
            <button
              key={slot.key}
              type="button"
              className={`weapon-slot ${slot.active ? "is-active" : ""}`}
              onPointerDown={draw(slot.slot)}
              onClick={draw(slot.slot)}
              onContextMenu={(event) => event.preventDefault()}
              aria-pressed={slot.active}
              aria-label={slot.active ? `${slot.item.name}, weapon in hand` : `Draw ${slot.item.name}`}
            >
              <span className="slot-key">{slot.key}</span>
              <HudWeaponGlyph />
              <span className="slot-copy">
                <b>{slot.item.name}</b>
                {slot.active
                  ? <small><AmmoMag /> / <AmmoReserve /></small>
                  : <small>{weaponAmmo[slot.slot] == null ? weaponProfileFor(slot.itemId).magazineSize : weaponAmmo[slot.slot]} RDS · TAP</small>}
              </span>
            </button>
          ) : (
            <div key={slot.key} className="weapon-slot is-empty" aria-label={`Weapon slot ${slot.key} empty`}>
              <span className="slot-key">{slot.key}</span>
              <HudWeaponGlyph />
              <span className="slot-copy"><b>EMPTY</b><small>NO WEAPON</small></span>
            </div>
          ))}
        </section>
      );
    });

    const Compass = React.memo(function Compass() {
      const rootRef = React.useRef(null);
      const headingRef = React.useRef(null);
      const directionRef = React.useRef(null);
      const initialHeading = hudTelemetry.heading;
      const initialDirection = COMPASS_DIRECTIONS[Math.round(initialHeading / 45) % 8];
      useEffect(() => {
        hudDom.compass = rootRef.current;
        hudDom.heading = headingRef.current;
        hudDom.direction = directionRef.current;
        writeHeadingDom(hudTelemetry.heading);
        return () => {
          if (hudDom.compass === rootRef.current) hudDom.compass = null;
          if (hudDom.heading === headingRef.current) hudDom.heading = null;
          if (hudDom.direction === directionRef.current) hudDom.direction = null;
        };
      }, []);
      return (
        <div ref={rootRef} className="compass" role="img" aria-label={`Compass heading ${initialHeading} degrees ${initialDirection}`}>
          <div className="compass-head">
            <span ref={headingRef}>HDG {String(initialHeading).padStart(3, "0")}°</span>
            <b ref={directionRef}>{initialDirection}</b>
            <span>SECTOR KARST-9</span>
          </div>
          <div className="compass-strip" aria-hidden="true">
            {COMPASS_BEARINGS.map((bearing) => (
              <span
                key={bearing.label}
                className={`compass-letter ${bearing.major ? "is-major" : ""} ${bearing.active ? "is-active" : ""}`}
                style={{ position: "absolute", left: `${bearing.left}%`, transform: "translateX(-50%)" }}
              >
                {bearing.label}
              </span>
            ))}
          </div>
        </div>
      );
    });

    const ObjectiveLabel = React.memo(function ObjectiveLabel() {
      const objectiveRef = React.useRef(null);
      const stateRef = React.useRef(null);
      const initialDist = hudTelemetry.objectiveDistance;
      const initialBearing = hudTelemetry.objectiveBearing;
      useEffect(() => {
        hudDom.objective = objectiveRef.current;
        hudDom.objectiveState = stateRef.current;
        writeObjectiveDom(hudTelemetry.objectiveDistance, hudTelemetry.objectiveBearing);
        return () => {
          if (hudDom.objective === objectiveRef.current) hudDom.objective = null;
          if (hudDom.objectiveState === stateRef.current) hudDom.objectiveState = null;
        };
      }, []);
      return (
        <div className="hud-radar-label">
          <b>RELAY STATION</b>
          <span ref={objectiveRef}>{initialDist} M / {String(initialBearing).padStart(3, "0")}°</span>
          <span ref={stateRef}>{initialDist <= 16 ? "AT OBJECTIVE" : "HOLDING POSITION"}</span>
        </div>
      );
    });

    // Scope sight picture: opacity follows the world's ADS blend through a
    // direct-DOM rAF write, so scoping never re-renders React per frame.
    const ScopeOverlay = React.memo(function ScopeOverlay() {
      const rootRef = React.useRef(null);
      useEffect(() => {
        let raf = 0;
        const paint = () => {
          const node = rootRef.current;
          if (node) {
            const blend = Math.max(0, Math.min(1, debugStats.adsBlend || 0));
            node.style.opacity = String(blend);
            node.style.visibility = blend > 0.02 ? "visible" : "hidden";
            node.style.transform = `scale(${1.08 - blend * 0.08})`;
          }
          raf = window.requestAnimationFrame(paint);
        };
        paint();
        return () => window.cancelAnimationFrame(raf);
      }, []);
      return (
        <div ref={rootRef} className="scope-overlay" aria-hidden="true">
          <span className="scope-ring" />
          <span className="scope-line is-h" />
          <span className="scope-line is-v" />
          <span className="scope-dot" />
        </div>
      );
    });

    const Crosshair = React.memo(function Crosshair() {
      const rootRef = React.useRef(null);
      const rangeRef = React.useRef(null);
      useEffect(() => {
        hudDom.range = rangeRef.current;
        writeObjectiveDom(hudTelemetry.objectiveDistance, hudTelemetry.objectiveBearing);
        let timer = 0;
        const unsubscribe = gameStore.subscribe((state, prev) => {
          if (state.shots <= prev.shots || !rootRef.current) return;
          rootRef.current.classList.add("is-firing");
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (rootRef.current) rootRef.current.classList.remove("is-firing");
          }, 120);
        });
        return () => {
          unsubscribe();
          window.clearTimeout(timer);
          if (hudDom.range === rangeRef.current) hudDom.range = null;
        };
      }, []);
      return (
        <div ref={rootRef} className="crosshair" aria-hidden="true">
          <span className="ch-ring" />
          <span className="ch-line top" />
          <span className="ch-line bottom" />
          <span className="ch-line left" />
          <span className="ch-line right" />
          <span className="ch-dot" />
          <span className="ch-corner a" />
          <span className="ch-corner b" />
          <span className="ch-corner c" />
          <span className="ch-corner d" />
          <span ref={rangeRef} className="ch-range">ENGAGE / {hudTelemetry.objectiveDistance}M</span>
        </div>
      );
    });

    // Always-readable world coordinates (metres). Say "spawn X at
    // 120, -340" and that is exactly where it will go.
    const CoordinateReadout = React.memo(function CoordinateReadout() {
      const valueRef = React.useRef(null);
      useEffect(() => {
        let raf = 0; let last = "";
        const paint = () => {
          const d = debugStats;
          const text = `X ${Math.round(d.playerX || 0)} · Z ${Math.round(d.playerZ || 0)} · Y ${Math.round(d.playerY || 0)} M`;
          if (valueRef.current && text !== last) { last = text; valueRef.current.textContent = text; }
          raf = window.requestAnimationFrame(paint);
        };
        paint();
        return () => window.cancelAnimationFrame(raf);
      }, []);
      return (
        <div className="hud-coordinates" aria-label="Current world coordinates">
          <span>COORD</span><b ref={valueRef}>X 0 · Z 0 · Y 0 M</b>
        </div>
      );
    });

    // Generic aircraft DRIVE / HUD / touch-flight surface. The Warthog is
    // the first consumer; future airframes only need to publish the same
    // debugStats.aircraft* telemetry and flight input fields. Visibility
    // and all fast-moving values are direct-DOM writes, never React state.
    // Bottom-left 2D airframe status: the same stable component IDs used
    // by the world damage solver, so a future aircraft can reuse this
    // diagram by publishing identical component percentages.
    const AircraftDamageDiagram = React.memo(function AircraftDamageDiagram({ damage }) {
      const fill = (id) => aircraftComponentColor(damage?.[id] ?? 1);
      const pct = (id) => Math.round((damage?.[id] ?? 1) * 100);
      const worst = AIRCRAFT_COMPONENTS.reduce((current, component) => (
        (damage?.[component.id] ?? 1) < (damage?.[current.id] ?? 1) ? component : current
      ), AIRCRAFT_COMPONENTS[0]);
      return (
        <section className="aircraft-damage-diagram" aria-label="Aircraft component damage diagram">
          <header><span>AIRFRAME</span><b>{pct(worst.id)}%</b></header>
          <svg viewBox="0 0 120 132" role="img" aria-label={`Worst component ${worst.label} at ${pct(worst.id)} percent`}>
            <rect x="56.5" y="1" width="7" height="17" rx="2" fill={fill("gun")}><title>{`Forward gun ${pct("gun")}%`}</title></rect>
            <polygon points="60,54 7,79 7,90 60,72" fill={fill("wing-port")}><title>{`Port wing ${pct("wing-port")}%`}</title></polygon>
            <polygon points="60,54 113,79 113,90 60,72" fill={fill("wing-starboard")}><title>{`Starboard wing ${pct("wing-starboard")}%`}</title></polygon>
            <path d="M60 8 C67 17 68.5 35 68 61 L67 103 C66.5 114 53.5 114 53 103 L52 61 C51.5 35 53 17 60 8 Z" fill={fill("fuselage")}><title>{`Fuselage ${pct("fuselage")}%`}</title></path>
            <ellipse cx="60" cy="31" rx="8" ry="14" fill={fill("canopy")}><title>{`Cockpit ${pct("canopy")}%`}</title></ellipse>
            <rect x="42" y="66" width="10" height="30" rx="4" fill={fill("engine-port")}><title>{`Port engine ${pct("engine-port")}%`}</title></rect>
            <rect x="68" y="66" width="10" height="30" rx="4" fill={fill("engine-starboard")}><title>{`Starboard engine ${pct("engine-starboard")}%`}</title></rect>
            <polygon points="54,103 24,120 24,128 57,115" fill={fill("empennage")}><title>{`Tail ${pct("empennage")}%`}</title></polygon>
            <polygon points="66,103 96,120 96,128 63,115" fill={fill("empennage")}><title>{`Tail ${pct("empennage")}%`}</title></polygon>
            <rect x="48" y="104" width="6" height="18" rx="2" fill={fill("empennage")} />
            <rect x="66" y="104" width="6" height="18" rx="2" fill={fill("empennage")} />
            {[25, 39, 81, 95].map((x) => <circle key={x} cx={x} cy="83" r="3.4" fill={fill("stores")}><title>{`Stores and launchers ${pct("stores")}%`}</title></circle>)}
            {[47, 73].map((x) => <rect key={x} x={x - 3} y="76" width="6" height="6" rx="1.5" fill={fill("gear")}><title>{`Landing gear ${pct("gear")}%`}</title></rect>)}
            <rect x="57" y="45" width="6" height="6" rx="1.5" fill={fill("gear")} />
          </svg>
          <footer><span>{worst.short}</span><b>{pct(worst.id) <= 0 ? "DESTROYED" : pct(worst.id) < 100 ? "DAMAGED" : "ALL INTACT"}</b></footer>
        </section>
      );
    });

    const AircraftInterface = React.memo(function AircraftInterface() {
      const hasStarted = useGameStore((state) => state.hasStarted);
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      const [damageSnapshot, setDamageSnapshot] = useState(() => Object.fromEntries(AIRCRAFT_COMPONENTS.map((component) => [component.id, 1])));
      const [cameraMode, setCameraMode] = useState(inputState.aircraftCameraMode || "cockpit");
      const damageSeqRef = React.useRef(-1);
      const cameraModeRef = React.useRef(inputState.aircraftCameraMode || "cockpit");
      const driveRef = React.useRef(null);
      const driveLabelRef = React.useRef(null);
      const driveSubRef = React.useRef(null);
      const flightRef = React.useRef(null);
      const telemetryRef = React.useRef(null);
      const exitRef = React.useRef(null);
      const aircraftNameRef = React.useRef(null);
      const headingRef = React.useRef(null);
      const canopyRef = React.useRef(null);
      const horizonRef = React.useRef(null);
      const speedRef = React.useRef(null);
      const aoaGRef = React.useRef(null);
      const altRef = React.useRef(null);
      const vsiGearRef = React.useRef(null);
      const throttleFillRef = React.useRef(null);
      const throttleHandleRef = React.useRef(null);
      const throttleValueRef = React.useRef(null);
      const assistButtonRef = React.useRef(null);
      const assistStateRef = React.useRef(null);
      const gearButtonRef = React.useRef(null);
      const gearStateRef = React.useRef(null);
      const assistModeRef = React.useRef(null);
      const modeRef = React.useRef(null);
      const spoolRef = React.useRef(null);
      const pitchRollRef = React.useRef(null);
      const controlValueRef = React.useRef(null);
      const triWRef = React.useRef(null);
      const triSRef = React.useRef(null);
      const triARef = React.useRef(null);
      const triDRef = React.useRef(null);
      const advisoryRef = React.useRef(null);
      const gunButtonRef = React.useRef(null);
      const gunValueRef = React.useRef(null);
      const missileButtonRef = React.useRef(null);
      const missileValueRef = React.useRef(null);
      const pointerRef = React.useRef({ throttleId: null });
      useEffect(() => {
        let raf = 0;
        let lastPaintAt = -Infinity;
        let lastOccupied = null;
        let lastThrottlePct = -1;
        let lastHorizonTransform = "";
        const writeText = (ref, text) => {
          const node = ref.current;
          if (node && node.textContent !== text) node.textContent = text;
        };
        const setDisplay = (ref, value) => {
          const node = ref.current;
          if (node && node.style.display !== value) node.style.display = value;
        };
        const paint = (now = performance.now()) => {
          const d = debugStats;
          const occupied = !!d.jetOccupied;
          // DOM painting does not need to chase every WebGL frame. The
          // seated console paints at 30 Hz and the hidden on-foot state at
          // 10 Hz; this halves layout/composite pressure on phones while
          // flight physics and pointer input stay at full rate.
          const paintInterval = occupied ? 33 : 100;
          if (now - lastPaintAt < paintInterval) {
            raf = window.requestAnimationFrame(paint);
            return;
          }
          lastPaintAt = now;
          if (d.aircraftDamageSeq !== damageSeqRef.current && d.aircraftComponents) {
            damageSeqRef.current = d.aircraftDamageSeq;
            setDamageSnapshot({ ...d.aircraftComponents });
          }
          const worldCameraMode = d.aircraftCameraMode || inputState.aircraftCameraMode || "cockpit";
          if (worldCameraMode !== cameraModeRef.current) {
            cameraModeRef.current = worldCameraMode;
            setCameraMode(worldCameraMode);
          }
          if (lastOccupied !== occupied) {
            lastOccupied = occupied;
            document.body.classList.toggle("aircraft-seated", occupied);
          }
          setDisplay(driveRef, d.jetNear ? "flex" : "none");
          writeText(driveLabelRef, d.jetEntryPhase === "opening" ? "OPENING" : "DRIVE");
          writeText(driveSubRef, d.jetEntryPhase === "opening" ? `CANOPY ${d.jetCanopyPct || 0}%` : "WARTHOG · X 18 · Z 0");
          setDisplay(flightRef, occupied ? "flex" : "none");
          if (flightRef.current) {
            flightRef.current.classList.toggle("is-stall", !!d.jetStall);
            flightRef.current.classList.toggle("is-crashed", !!d.jetCrashed);
          }
          if (!occupied) {
            raf = window.requestAnimationFrame(paint);
            return;
          }
          const telemetry = {
            name: d.aircraftName || "AIRCRAFT",
            pitch: d.aircraftPitchDeg || 0,
            roll: d.aircraftRollDeg || 0,
            heading: d.aircraftHeadingDeg || 0,
            speed: d.jetSpeedKmh || 0,
            altitude: d.jetAltitudeM || 0,
            vertical: d.aircraftVerticalMps ?? d.jetVerticalMps ?? 0,
            throttle: d.jetThrottlePct || 0,
            aoa: d.jetAoaDeg || 0,
            loadG: d.jetLoadG || 0,
            canopy: d.jetCanopyPct || 0,
          };
          writeText(aircraftNameRef, telemetry.name);
          writeText(headingRef, `HDG ${String(Math.round(telemetry.heading)).padStart(3, "0")}°`);
          writeText(canopyRef, telemetry.canopy > 1 ? `CANOPY ${Math.round(telemetry.canopy)}%` : "CANOPY LATCHED");
          if (horizonRef.current) {
            const pitchRad = telemetry.pitch * Math.PI / 180;
            const pitchPx = Math.round(Math.sin(pitchRad) * 58 * 2) / 2;
            const flip = Math.cos(pitchRad) < 0 ? 180 : 0; // attitude ball past vertical/inverted
            const rollDeg = Math.round((-telemetry.roll + flip) * 2) / 2;
            const nextTransform = `translate(-50%, -50%) translateY(${pitchPx}px) rotate(${rollDeg}deg)`;
            if (nextTransform !== lastHorizonTransform) {
              lastHorizonTransform = nextTransform;
              horizonRef.current.style.transform = nextTransform;
            }
          }
          writeText(speedRef, `${Math.round(telemetry.speed)} KM/H`);
          writeText(aoaGRef, `AOA ${Number(telemetry.aoa).toFixed(1)}° · ${Number(telemetry.loadG).toFixed(2)} G`);
          writeText(altRef, `${Number(telemetry.altitude).toFixed(1)} M`);
          writeText(vsiGearRef, `VS ${telemetry.vertical >= 0 ? "+" : ""}${Number(telemetry.vertical).toFixed(1)} M/S · GEAR ${d.jetGearDown ? "DOWN" : "UP"}`);
          const throttlePct = Math.round(Math.max(0, Math.min(100, telemetry.throttle)));
          if (throttlePct !== lastThrottlePct) {
            lastThrottlePct = throttlePct;
            if (throttleFillRef.current) throttleFillRef.current.style.height = `${throttlePct}%`;
            if (throttleHandleRef.current) throttleHandleRef.current.style.bottom = `${throttlePct}%`;
          }
          writeText(throttleValueRef, `${throttlePct}%`);
          const assistLevel = d.aircraftAssistLevel ?? inputState.flightAssistLevel ?? ((d.aircraftAssist ?? (inputState.flightAssist ? 1 : 0)) ? 1 : 0);
          const assistOn = assistLevel > 0;
          if (assistButtonRef.current) {
            assistButtonRef.current.classList.toggle("is-on", assistLevel === 1);
            assistButtonRef.current.classList.toggle("is-autopilot", assistLevel === 2);
          }
          writeText(assistStateRef, assistLevel === 2 ? "AUTO" : assistLevel === 1 ? "BALANCE" : "MANUAL");
          writeText(assistModeRef, assistOn ? (d.aircraftAssistMode || "AI BALANCE") : "MANUAL");
          if (gearButtonRef.current) {
            gearButtonRef.current.classList.toggle("is-down", !!d.jetGearDown);
            gearButtonRef.current.classList.toggle("is-up", !d.jetGearDown);
          }
          const gearMode = d.aircraftGearMode || "AUTO";
          writeText(gearStateRef, `${d.jetGearDown ? "DOWN" : "UP"} · ${gearMode === "MAN" ? "MAN" : "AUTO"}`);
          writeText(modeRef, `MODE ${d.aircraftMode || d.jetGroundMode || (d.jetAirborne ? "AIR" : "TAXI")}`);
          writeText(spoolRef, `THR ${Math.round(telemetry.throttle)}% · SPOOL ${Math.round(d.jetSpoolPct || 0)}% · STEER ${Math.round(d.jetSteerDeg || 0)}°`);
          writeText(pitchRollRef, `PITCH ${telemetry.pitch >= 0 ? "+" : ""}${Number(telemetry.pitch).toFixed(0)}° · ROLL ${telemetry.roll >= 0 ? "+" : ""}${Number(telemetry.roll).toFixed(0)}°`);
          const controlPitch = d.aircraftControlPitch ?? inputState.flightPitchInput ?? 0;
          const controlRoll = d.aircraftControlRoll ?? inputState.flightRollInput ?? 0;
          if (controlValueRef.current) {
            const signed = (v) => `${v >= 0 ? "+" : "−"}${String(Math.abs(Math.round(v * 100))).padStart(2, "0")}`;
            writeText(controlValueRef, `P ${signed(controlPitch)} · R ${signed(controlRoll)}${d.flightInvertPitch || d.flightInvertRoll ? " · INV" : ""}`);
          }
          const keySet = inputState.keys;
          const wHeld = (inputState.flightPitchInput || 0) > 0.5 || keySet.has("KeyW") || keySet.has("ArrowUp");
          const sHeld = (inputState.flightPitchInput || 0) < -0.5 || keySet.has("KeyS") || keySet.has("ArrowDown");
          const aHeld = (inputState.flightRollInput || 0) < -0.5 || keySet.has("KeyA") || keySet.has("ArrowLeft");
          const dHeld = (inputState.flightRollInput || 0) > 0.5 || keySet.has("KeyD") || keySet.has("ArrowRight");
          if (triWRef.current) triWRef.current.classList.toggle("is-active", wHeld);
          if (triSRef.current) triSRef.current.classList.toggle("is-active", sHeld);
          if (triARef.current) triARef.current.classList.toggle("is-active", aHeld);
          if (triDRef.current) triDRef.current.classList.toggle("is-active", dHeld);
          if (advisoryRef.current) {
            writeText(advisoryRef, d.aircraftAdvisory || "SYSTEMS NOMINAL");
            const advisoryClass = `aircraft-advisory is-${d.aircraftAdvisoryLevel || "info"}`;
            if (advisoryRef.current.className !== advisoryClass) advisoryRef.current.className = advisoryClass;
          }
          setDisplay(gunButtonRef, d.aircraftHasGun ? "flex" : "none");
          if (gunButtonRef.current) {
            gunButtonRef.current.classList.toggle("is-offline", !d.aircraftGunOperational || !(d.aircraftGunAmmo > 0));
            gunButtonRef.current.classList.toggle("is-firing", !!d.aircraftGunFiring);
          }
          writeText(gunValueRef, !d.aircraftGunOperational ? "OFFLINE" : `${d.aircraftGunAmmo || 0} RDS`);
          setDisplay(missileButtonRef, d.aircraftHasMissiles ? "flex" : "none");
          if (missileButtonRef.current) {
            missileButtonRef.current.classList.toggle("is-offline", !d.aircraftMissilesOperational || !(d.aircraftMissiles > 0));
          }
          writeText(missileValueRef, !d.aircraftMissilesOperational ? "OFFLINE" : `${d.aircraftMissiles || 0} READY`);
          writeText(telemetryRef, `${d.jetMessage || telemetry.name} · ${telemetry.speed} KM/H · ALT ${telemetry.altitude} M · THR ${telemetry.throttle}% · AOA ${telemetry.aoa}°`);
          writeText(exitRef, "EXIT");
          if (exitRef.current) exitRef.current.classList.toggle("is-blocked", !d.jetCanExit);
          raf = window.requestAnimationFrame(paint);
        };
        paint();
        return () => {
          window.cancelAnimationFrame(raf);
          document.body.classList.remove("aircraft-seated");
          inputState.flightPitchInput = 0;
          inputState.flightRollInput = 0;
          inputState.flightThrottleTarget = null;
          inputState.aircraftGunHeld = false;
          inputState.aircraftMissileLaunch = false;
          inputState.flightGearToggle = false;
        };
      }, []);
      if (!hasStarted || isMenuOpen) return null;
      const queue = (action) => (event) => { event.preventDefault(); inputState.jetAction = action; };
      const toggleCamera = (event) => {
        event.preventDefault();
        const next = (inputState.aircraftCameraMode || "cockpit") === "chase" ? "cockpit" : "chase";
        inputState.aircraftCameraMode = next;
        cameraModeRef.current = next;
        setCameraMode(next);
      };
      const launchMissile = (event) => {
        event.preventDefault();
        inputState.aircraftMissileLaunch = true;
      };
      const toggleAssist = (event) => {
        event.preventDefault();
        const current = inputState.flightAssistLevel ?? (inputState.flightAssist ? 1 : 0);
        const next = (current + 1) % 3; // BALANCE -> AUTOPILOT -> MANUAL
        inputState.flightAssistLevel = next;
        inputState.flightAssist = next > 0;
        if (assistButtonRef.current) {
          assistButtonRef.current.classList.toggle("is-on", next === 1);
          assistButtonRef.current.classList.toggle("is-autopilot", next === 2);
        }
        if (assistStateRef.current) assistStateRef.current.textContent = next === 2 ? "AUTO" : next === 1 ? "BALANCE" : "MANUAL";
      };
      const toggleGear = (event) => {
        event.preventDefault();
        inputState.flightGearToggle = true;
      };
      const hold = (set, clear) => ({
        onPointerDown: (event) => {
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
          event.currentTarget.classList.add("is-active");
          set();
        },
        onPointerUp: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onPointerCancel: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onLostPointerCapture: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onContextMenu: (event) => event.preventDefault(),
      });
      const axisHold = (field, value) => ({
        onPointerDown: (event) => {
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
          event.currentTarget.classList.add("is-active");
          inputState[field] = value;
        },
        onPointerUp: (event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onPointerCancel: (event) => {
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onLostPointerCapture: (event) => {
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onContextMenu: (event) => event.preventDefault(),
      });
      const setThrottleFromEvent = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        inputState.flightThrottleTarget = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
      };
      const endThrottle = (event) => {
        if (pointerRef.current.throttleId === event.pointerId) pointerRef.current.throttleId = null;
      };
      const flightThrottleHandlers = {
        onPointerDown: (event) => {
          event.preventDefault();
          pointerRef.current.throttleId = event.pointerId;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
          setThrottleFromEvent(event);
        },
        onPointerMove: (event) => { if (pointerRef.current.throttleId === event.pointerId) setThrottleFromEvent(event); },
        onPointerUp: endThrottle,
        onPointerCancel: endThrottle,
        onLostPointerCapture: endThrottle,
        onContextMenu: (event) => event.preventDefault(),
      };
      return (
        <div className="jet-interface">
          <button ref={driveRef} type="button" className="jet-drive-btn" style={{ display: "none" }} onPointerDown={queue("enter")} onClick={queue("enter")} aria-label="Drive the Warthog">
            <strong ref={driveLabelRef}>DRIVE</strong><small ref={driveSubRef}>WARTHOG · X 18 · Z 0</small>
          </button>
          <div ref={flightRef} className="jet-flight aircraft-console" style={{ display: "none" }}>
            <button type="button" className={`aircraft-camera-toggle is-${cameraMode}`} onPointerDown={toggleCamera} aria-label={`Aircraft camera ${cameraMode}. Tap to switch camera mode`}>
              <small>CAMERA</small><strong>{cameraMode === "chase" ? "3RD PERSON" : "COCKPIT"}</strong><span>{cameraMode === "chase" ? "CHASE VIEW" : "FIRST PERSON"}</span>
            </button>
            <AircraftDamageDiagram damage={damageSnapshot} />
            <div className="aircraft-hud" aria-hidden="true">
              <div className="aircraft-hud-top"><span ref={aircraftNameRef}>A-10C WARTHOG</span><div className="aircraft-hud-centre"><b ref={headingRef}>HDG 000°</b><small ref={modeRef}>MODE TAXI</small></div><span ref={canopyRef}>CANOPY LATCHED</span></div>
              <div ref={advisoryRef} className="aircraft-advisory is-info">SYSTEMS NOMINAL</div>
              <div className="aircraft-attitude">
                <div ref={horizonRef} className="aircraft-horizon">
                  <i className="aircraft-horizon-sky" /><i className="aircraft-horizon-ground" />
                  <span className="aircraft-pitch-line is-plus-20" /><span className="aircraft-pitch-line is-plus-10" /><span className="aircraft-pitch-line is-zero" /><span className="aircraft-pitch-line is-minus-10" /><span className="aircraft-pitch-line is-minus-20" />
                  <span className="aircraft-pitch-label is-plus-20">+20</span><span className="aircraft-pitch-label is-minus-20">−20</span>
                </div>
                <span className="aircraft-bank-tick is-b60" /><span className="aircraft-bank-tick is-b30" /><span className="aircraft-bank-tick is-b0" /><span className="aircraft-bank-tick is-a30" /><span className="aircraft-bank-tick is-a60" />
                <div className="aircraft-fixed-symbol"><i /><b /><i /></div>
                <div className="aircraft-roll-pointer" />
              </div>
              <div className="aircraft-readout is-left"><small>SPEED</small><b ref={speedRef}>0 KM/H</b><span ref={aoaGRef}>AOA 0.0° · 0.00 G</span><span ref={spoolRef}>THR 0% · SPOOL 0% · STEER 0°</span></div>
              <div className="aircraft-readout is-right"><small>ALTITUDE AGL</small><b ref={altRef}>0.0 M</b><span ref={vsiGearRef}>VS +0.0 M/S · GEAR DOWN</span><span ref={pitchRollRef}>PITCH +0° · ROLL +0°</span></div>
            </div>
            <div className="aircraft-touch-controls">
              <div className="flight-tri-pad is-pitch" aria-label="W and S pitch rocker">
                <button ref={triWRef} type="button" className="flight-tri is-w" {...axisHold("flightPitchInput", 1)} aria-label="W rocker: pitch up on the ground to take off; climb in the air"><span>W</span></button>
                <div className="flight-tri-centre"><small ref={controlValueRef}>P +00 · R +00</small><label>PITCH</label><small ref={assistModeRef}>AI BALANCE</small></div>
                <button ref={triSRef} type="button" className="flight-tri is-s" {...axisHold("flightPitchInput", -1)} aria-label="S rocker: brake then slow reverse on the ground; nose down in the air"><span>S</span></button>
              </div>
              <div className="aircraft-bottom-console">
                <div ref={telemetryRef} className="jet-telemetry" role="status">ENGINE READY</div>
                <div className="jet-flight-buttons">
                  <button type="button" {...hold(() => { inputState.flightThrottleTarget = null; inputState.jetThrottleDelta = -1; }, () => { inputState.jetThrottleDelta = 0; })} aria-label="Decrease thrust">THR −</button>
                  <button type="button" {...hold(() => { inputState.flightThrottleTarget = null; inputState.jetThrottleDelta = 1; }, () => { inputState.jetThrottleDelta = 0; })} aria-label="Increase thrust">THR +</button>
                  <button type="button" {...hold(() => { inputState.jetBrake = true; }, () => { inputState.jetBrake = false; })} aria-label="Hold brakes on the ground or airbrake in flight">BRK</button>
                  <button ref={gearButtonRef} type="button" className="is-gear is-down" onPointerDown={toggleGear} aria-label="Toggle landing gear manually; automatic gear resumes when the flight phase changes"><strong>GEAR</strong><small ref={gearStateRef}>DOWN · AUTO</small></button>
                  <button ref={assistButtonRef} type="button" className="is-assist is-on" onPointerDown={toggleAssist} aria-label="Cycle AI between balance assist, full autopilot and manual flight"><strong>AI</strong><small ref={assistStateRef}>BALANCE</small></button>
                  <button ref={exitRef} type="button" onPointerDown={queue("exit")} onClick={queue("exit")} aria-label="Exit the aircraft">EXIT</button>
                </div>
                <div className="jet-weapon-buttons">
                  <button ref={gunButtonRef} type="button" {...hold(() => { inputState.aircraftGunHeld = true; }, () => { inputState.aircraftGunHeld = false; })} aria-label="Hold to fire the installed forward gun"><strong>GUN</strong><small ref={gunValueRef}>1174 RDS</small></button>
                  <button ref={missileButtonRef} type="button" onPointerDown={launchMissile} onClick={launchMissile} aria-label="Launch a guided missile"><strong>MSL</strong><small ref={missileValueRef}>2 READY</small></button>
                  <button type="button" className="is-eject" onPointerDown={queue("eject")} onClick={queue("eject")} aria-label="Eject from the aircraft"><strong>EJECT</strong><small>ESCAPE</small></button>
                </div>
                <div className="jet-flight-hint">AI: SET THRUST · A/D STEER · HOLD W · RELEASE = LEVEL · AI OFF = MANUAL</div>
              </div>
              <div className="flight-tri-pad is-roll" aria-label="A and D steering and roll rocker">
                <button ref={triARef} type="button" className="flight-tri is-a" {...axisHold("flightRollInput", -1)} aria-label="A rocker: steer left on the ground; bank left in the air"><span>A</span></button>
                <div className="flight-tri-centre"><label>STEER · BANK</label><small>AI COORD</small></div>
                <button ref={triDRef} type="button" className="flight-tri is-d" {...axisHold("flightRollInput", 1)} aria-label="D rocker: steer right on the ground; bank right in the air"><span>D</span></button>
              </div>
              <div className="flight-throttle" {...flightThrottleHandlers} role="slider" aria-label="Manual thrust slider: set the power level and leave it there" aria-valuemin="0" aria-valuemax="100">
                <span className="flight-throttle-track"><i ref={throttleFillRef} /><em ref={throttleHandleRef} /></span>
                <label>THRUST</label><b ref={throttleValueRef}>0%</b><small>GEAR QUADRANT</small>
              </div>
            </div>
          </div>
        </div>
      );
    });

    const TANK_PART_LABELS = [
      ["hull", "Hull"], ["turret", "Turret"], ["gun", "120 mm cannon"], ["engine", "Powerpack"],
      ["track-port", "Track · port"], ["track-starboard", "Track · stbd"], ["ammo", "Ammo rack"],
    ];
    const tankPartColor = (pct) => (pct > 0.66 ? "#a3e635" : pct > 0.4 ? "#facc15" : pct > 0.15 ? "#fb923c" : "#f87171");
    const TankDamageList = React.memo(function TankDamageList({ damage }) {
      return (
        <div className="tank-damage" aria-label="Tank component damage">
          <strong>ABRAMS</strong>
          {TANK_PART_LABELS.map(([id, label]) => {
            const pct = Math.max(0, Math.min(1, damage[id] ?? 1));
            return (
              <div key={id} className="tank-damage-row">
                <span>{label}</span>
                <i style={{ width: `${Math.round(pct * 100)}%`, background: tankPartColor(pct) }} />
                <b>{Math.round(pct * 100)}%</b>
              </div>
            );
          })}
        </div>
      );
    });

    const TankInterface = React.memo(function TankInterface() {
      const hasStarted = useGameStore((state) => state.hasStarted);
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      const [damageSnapshot, setDamageSnapshot] = useState(() => ({ hull: 1, turret: 1, gun: 1, engine: 1, "track-port": 1, "track-starboard": 1, ammo: 1 }));
      const damageSeqRef = React.useRef(-1);
      const driveRef = React.useRef(null);
      const consoleRef = React.useRef(null);
      const telemetryRef = React.useRef(null);
      const ammoRef = React.useRef(null);
      const reloadBarRef = React.useRef(null);
      const gearValueRef = React.useRef(null);
      const aimRef = React.useRef({ id: null, lx: 0, ly: 0 });
      useEffect(() => {
        let raf = 0;
        let lastPaintAt = -Infinity;
        let lastOccupied = null;
        let lastReloadPct = -1;
        const writeText = (ref, text) => {
          const node = ref.current;
          if (node && node.textContent !== text) node.textContent = text;
        };
        const setDisplay = (ref, value) => {
          const node = ref.current;
          if (node && node.style.display !== value) node.style.display = value;
        };
        const paint = (now = performance.now()) => {
          const d = debugStats;
          const occupied = !!d.tankOccupied;
          const paintInterval = occupied ? 33 : 100; // 30 Hz crewed, 10 Hz idle (same contract as the jet console)
          if (now - lastPaintAt < paintInterval) {
            raf = window.requestAnimationFrame(paint);
            return;
          }
          lastPaintAt = now;
          if (d.tankDamageSeq !== damageSeqRef.current && d.tankComponents) {
            damageSeqRef.current = d.tankDamageSeq;
            setDamageSnapshot({ ...d.tankComponents });
          }
          if (lastOccupied !== occupied) {
            lastOccupied = occupied;
            document.body.classList.toggle("tank-seated", occupied);
          }
          setDisplay(driveRef, d.tankNear ? "flex" : "none");
          setDisplay(consoleRef, occupied ? "flex" : "none");
          if (!occupied) {
            raf = window.requestAnimationFrame(paint);
            return;
          }
          writeText(telemetryRef, `${d.tankMessage || "M1A2 // READY"} · ${d.tankSpeedKmh || 0} KM/H · TURRET ${d.tankTurretDeg || 0}° · GUN ${d.tankGunDeg || 0}° · HULL ${d.tankIntegrityPct ?? 100}%`);
          writeText(ammoRef, `HE ${d.tankAmmo ?? 0}`);
          writeText(gearValueRef, `${d.tankGearLabel || "N"} · ${d.tankSpeedKmh || 0}`);
          const reloadPct = d.tankReloadPct ?? 100;
          if (reloadPct !== lastReloadPct) {
            lastReloadPct = reloadPct;
            if (reloadBarRef.current) reloadBarRef.current.style.transform = `scaleX(${reloadPct / 100})`;
          }
          raf = window.requestAnimationFrame(paint);
        };
        paint();
        return () => {
          window.cancelAnimationFrame(raf);
          document.body.classList.remove("tank-seated");
          inputState.tankDriveInput = 0;
          inputState.tankSteerInput = 0;
          inputState.tankFireHeld = false;
          inputState.tankAction = null;
        };
      }, []);
      if (!hasStarted || isMenuOpen) return null;
      const queue = (action) => (event) => { event.preventDefault(); inputState.tankAction = action; };
      const hold = (set, clear) => ({
        onPointerDown: (event) => {
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
          event.currentTarget.classList.add("is-active");
          set();
        },
        onPointerUp: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onPointerCancel: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onLostPointerCapture: (event) => { event.currentTarget.classList.remove("is-active"); clear(); },
        onContextMenu: (event) => event.preventDefault(),
      });
      const axisHold = (field, value) => ({
        onPointerDown: (event) => {
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
          event.currentTarget.classList.add("is-active");
          inputState[field] = value;
        },
        onPointerUp: (event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onPointerCancel: (event) => {
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onLostPointerCapture: (event) => {
          event.currentTarget.classList.remove("is-active");
          if (inputState[field] === value) inputState[field] = 0;
        },
        onContextMenu: (event) => event.preventDefault(),
      });
      // Turret aim: naked drag on the right half feeds lookDX/lookDY, the
      // same contract as the on-foot aim surface (desktop uses the global
      // mouse-drag handler, so this surface is touch/pen only).
      const aim = aimRef.current;
      const endAim = (event) => { if (aim.id === event.pointerId) aim.id = null; };
      const aimDragHandlers = {
        onPointerDown: (event) => {
          if (event.pointerType === "mouse" || aim.id !== null) return;
          aim.id = event.pointerId;
          aim.lx = event.clientX;
          aim.ly = event.clientY;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
        },
        onPointerMove: (event) => {
          if (aim.id !== event.pointerId) return;
          inputState.aimX = 0;
          inputState.aimY = 0;
          inputState.lookDX += event.clientX - aim.lx;
          inputState.lookDY += event.clientY - aim.ly;
          aim.lx = event.clientX;
          aim.ly = event.clientY;
        },
        onPointerUp: endAim,
        onPointerCancel: endAim,
      };
      return (
        <div className="jet-interface tank-interface">
          <button ref={driveRef} type="button" className="jet-drive-btn tank-drive-btn" style={{ display: "none" }} onPointerDown={queue("enter")} onClick={queue("enter")} aria-label="Drive the M1A2 Abrams tank">
            <strong>DRIVE</strong><small>M1A2 ABRAMS · CREWED</small>
          </button>
          <div ref={consoleRef} className="jet-flight tank-console" style={{ display: "none" }}>
            <div className="tank-aim-surface" {...aimDragHandlers} aria-hidden="true" />
            <div className="tank-reticle" aria-hidden="true"><i /><b /><span><em ref={reloadBarRef} /></span></div>
            <TankDamageList damage={damageSnapshot} />
            <div className="aircraft-touch-controls">
              <div className="flight-tri-pad is-pitch" aria-label="W and S tank drive rocker">
                <button type="button" className="flight-tri is-w" {...axisHold("tankDriveInput", 1)} aria-label="W rocker: drive forward"><span>W</span></button>
                <div className="flight-tri-centre"><small ref={gearValueRef}>N · 0</small><label>DRIVE</label><small>TRACKS</small></div>
                <button type="button" className="flight-tri is-s" {...axisHold("tankDriveInput", -1)} aria-label="S rocker: brake, then reverse"><span>S</span></button>
              </div>
              <div className="aircraft-bottom-console">
                <div ref={telemetryRef} className="jet-telemetry" role="status">M1A2 // READY</div>
                <div className="jet-flight-buttons">
                  <button type="button" onPointerDown={queue("exit")} onClick={queue("exit")} aria-label="Exit the tank">EXIT</button>
                </div>
              </div>
              <div className="flight-tri-pad is-roll" aria-label="A and D tank steering rocker">
                <button type="button" className="flight-tri is-a" {...axisHold("tankSteerInput", -1)} aria-label="A rocker: steer left; pivot at a stop"><span>A</span></button>
                <div className="flight-tri-centre"><label>STEER</label><small>PIVOT OK</small></div>
                <button type="button" className="flight-tri is-d" {...axisHold("tankSteerInput", 1)} aria-label="D rocker: steer right; pivot at a stop"><span>D</span></button>
              </div>
              <button type="button" className="tank-fire-btn" {...hold(() => { inputState.tankFireHeld = true; }, () => { inputState.tankFireHeld = false; })} aria-label="Hold to fire the 120 mm cannon">
                <strong>FIRE</strong><small ref={ammoRef}>HE 42</small><span>120 MM</span>
              </button>
            </div>
          </div>
        </div>
      );
    });

    const DeathOverlay = React.memo(function DeathOverlay() {
      const isDead = useGameStore((state) => state.isDead);
      const deathReason = useGameStore((state) => state.deathReason);
      const respawnPlayer = useGameStore((state) => state.respawnPlayer);
      if (!isDead) return null;
      return (
        <section className="death-overlay" role="alertdialog" aria-labelledby="death-title" aria-describedby="death-reason">
          <small>SIGNAL LOST // BLACK MERIDIAN</small>
          <h2 id="death-title">OPERATOR DOWN</h2>
          <p id="death-reason">{deathReason || "FATAL DAMAGE"}</p>
          <button type="button" onClick={respawnPlayer}>RESPAWN // REPAIR WARTHOG</button>
          <span>NEXT TIME: EJECT BEFORE THE FIRE REACHES FUEL OR STORES</span>
        </section>
      );
    });

    const HudPauseButton = React.memo(function HudPauseButton() {
      const openMenu = useGameStore((state) => state.openMenu);
      return (
        <button className="hud-pause" onClick={openMenu} aria-label="Open command menu">
          <span className="hud-pause-bars" aria-hidden="true"><i /><i /></span>
          <span>COMMAND</span>
          <kbd>ESC</kbd>
        </button>
      );
    });

    const HudDebugToggle = React.memo(function HudDebugToggle() {
      const showDebug = useGameStore((state) => state.showDebug);
      const toggleDebug = useGameStore((state) => state.toggleDebug);
      return (
        <button
          type="button"
          className={`hud-debug-toggle ${showDebug ? "is-on" : ""}`}
          onClick={toggleDebug}
          aria-pressed={showDebug}
          aria-label={showDebug ? "Turn F3 debug overlay off" : "Turn F3 debug overlay on"}
        >
          <span>F3</span><b>{showDebug ? "ON" : "OFF"}</b>
        </button>
      );
    });

    const GameHUD = React.memo(function GameHUD() {
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      return (
        <div className={`hud ${isMenuOpen ? "is-paused" : ""}`} aria-hidden={isMenuOpen ? "true" : undefined}>
          <div className="hud-top">
            <div className="hud-mission">
              <div className="hud-op"><span className="live-dot pulse" /> OP // BLACK MERIDIAN</div>
              <strong>SECURE THE RELAY</strong>
              <small>KARST-9 / GRID 04-C · <FactionCode /> FORWARD</small>
            </div>
            <Compass />
            <div className="hud-top-actions">
              <HudDebugToggle />
              <HudPauseButton />
            </div>
          </div>
          <CoordinateReadout />
          <Crosshair />
          <ObjectiveLabel />
          <div className="hud-bottom">
            <Vitals />
            <WeaponSlots />
            <div className="hud-bottom-spacer" aria-hidden="true" />
          </div>
          <div className="hud-hints" aria-hidden="true">
            <span><kbd>LEFT STICK</kbd> MOVE</span>
            <span><kbd>DRAG</kbd> AIM</span>
            <span><kbd>ADS</kbd> SCOPE</span>
            <span><kbd>FIRE</kbd> SHOOT</span>
            <span><kbd>RLD</kbd> RELOAD</span>
            <span><kbd>TAP GUN</kbd> SWAP</span>
          </div>
        </div>
      );
    });

    // === [UI: MAIN_MENU] ===
    function UiIcon({ name, size = 16 }) {
      const props = {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.25", strokeLinecap: "round",
        strokeLinejoin: "round", "aria-hidden": "true"
      };
      const paths = {
        play: <path d="M5 2.8 13 8l-8 5.2V2.8Z" fill="currentColor" stroke="none" />,
        grid: <><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></>,
        sliders: <><path d="M2 4h5M10 4h4M2 8h2M7 8h7M2 12h8M13 12h1" /><circle cx="8.5" cy="4" r="1.5" fill="var(--bg)" /><circle cx="5.5" cy="8" r="1.5" fill="var(--bg)" /><circle cx="11.5" cy="12" r="1.5" fill="var(--bg)" /></>,
        flag: <><path d="M3 14V2M3 2.5h9l-2 3 2 3H3" /></>,
        close: <><path d="m3 3 10 10M13 3 3 13" /></>,
        back: <><path d="m10 3-5 5 5 5" /><path d="M5 8h9" opacity=".4" /></>,
        arrow: <><path d="M2 8h11M9 4l4 4-4 4" /></>,
        alert: <><path d="M8 2 15 14H1L8 2Z" /><path d="M8 6v4M8 12v.2" /></>,
        target: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></>,
        check: <path d="m2.5 8 3.4 3.4L13.5 4" />,
        plus: <><path d="M8 2v12M2 8h12" /></>,
        weapon: <><path d="M1.5 6.5h10l2-1.5h1.5v2.5H12l-1.5 1.5H7l-1 2.5H4l.5-4.5h-3v-1Z" /></>,
        shield: <><path d="M8 1.5 14 4v4.5c0 3-2.5 5.2-6 6.5-3.5-1.3-6-3.5-6-6.5V4l6-2.5Z" /><path d="m5 8 2 2 4-4" /></>,
        joystick: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /><path d="M8 2.5V5M8 11v2.5M2.5 8H5M11 8h2.5" /></>,
        audio: <><path d="M2 6h3l3.5-3v10L5 10H2V6Z" /><path d="M11 5.5a4 4 0 0 1 0 5M12.8 3.5a7 7 0 0 1 0 9" /></>,
        monitor: <><rect x="1.5" y="2.5" width="13" height="9" /><path d="M5 14h6M8 11.5V14" /></>,
        chip: <><rect x="4" y="4" width="8" height="8" /><path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3" /></>,
        ruler: <><path d="M2 12 12 2l2 2L4 14l-2-2Z" /><path d="M9 5l1 1M6.5 7.5l1 1M4 10l1 1" /></>,
        dot: <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
      };
      return <svg {...props}>{paths[name] || paths.dot}</svg>;
    }

    const BrandMark = React.memo(function BrandMark() {
      return (
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 28 30" fill="none">
            <path d="M14 1 26 6v10c0 6.5-5 10.5-12 13C7 26.5 2 22.5 2 16V6L14 1Z" stroke="currentColor" strokeWidth="1.1" />
            <path d="M9 19V9l5 5 5-5v10" stroke="currentColor" strokeWidth="1.8" />
            <path d="M14 1v4M2 16h4M26 16h-4" stroke="currentColor" strokeWidth=".7" opacity=".5" />
          </svg>
        </span>
      );
    });

    const ConsoleHeader = React.memo(function ConsoleHeader() {
      const screen = useGameStore((state) => state.screen);
      const faction = useGameStore((state) => state.faction);
      const resume = useGameStore((state) => state.resume);
      const goHome = useGameStore((state) => state.goHome);
      const handleExit = () => {
        if (screen === "main") resume();
        else goHome();
      };

      return (
        <header className="console-header">
          <button className="brand" onClick={goHome} aria-label="Return to command menu">
            <BrandMark />
            <span className="brand-copy">
              <span className="brand-name">IRON<em>VEIL</em></span>
              <span className="brand-sub">TACTICAL OPERATIONS / 04</span>
            </span>
          </button>
          <div className="header-status" aria-label="Connection status">
            <span className="live-dot pulse" />
            <span className="status-label">SECURE UPLINK</span>
            <span className="status-divider" />
            <b>24 MS</b>
            <span className="status-divider" />
            <span>4 LINKED</span>
          </div>
          <div className="header-right">
            <div className="operator-chip">
              <span className="operator-avatar" aria-hidden="true">V7</span>
              <span className="operator-copy">
                <span className="operator-name">VEX-07</span>
                <span className="operator-role">LVL 24 / {faction}</span>
              </span>
            </div>
            <button className="header-exit" onClick={handleExit} aria-label={screen === "main" ? "Resume mission" : "Back to command menu"} title={screen === "main" ? "Resume / Escape" : "Back / Escape"}>
              <UiIcon name={screen === "main" ? "close" : "back"} size={13} />
            </button>
          </div>
        </header>
      );
    });

    const ConsoleFooter = React.memo(function ConsoleFooter() {
      return (
        <footer className="console-footer">
          <div className="footer-left">
            <span><kbd>ESC</kbd> RESUME</span>
            <span className="footer-hint-secondary"><kbd>↵</kbd> SELECT</span>
            <span className="footer-hint-secondary"><kbd>↑↓</kbd> NAVIGATE</span>
          </div>
          <div className="footer-right">
            <span>REACT 18</span>
            <span className="footer-sep" />
            <span>ZUSTAND / SELECTOR SCOPE</span>
            <span className="footer-sep" />
            <span className="footer-tech">UI ISOLATED</span>
          </div>
        </footer>
      );
    });

    const MenuFaction = React.memo(function MenuFaction() {
      const faction = useGameStore((state) => state.faction);
      return <strong className={faction === FACTION_B ? "danger" : "accent"}>{faction}</strong>;
    });

    const InventoryCount = React.memo(function InventoryCount() {
      const filled = useGameStore((state) => state.inventory.filter(Boolean).length);
      return <span>{filled} / {INVENTORY_SIZE} SLOTS LOADED</span>;
    });

    function TopoMap() {
      return (
        <div className="intel-card map-card">
          <div className="intel-head">
            <span>SECTOR MAP / LIVE</span>
            <b>KARST-9</b>
          </div>
          <div className="map-wrap">
            <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Tactical map of the Karst-9 relay sector">
              <defs>
                <pattern id="topoGrid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M24 0H0V24" className="map-svg-grid" fill="none" />
                </pattern>
                <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#c8f45c" stopOpacity=".2" />
                  <stop offset="100%" stopColor="#c8f45c" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width="400" height="180" fill="#09100a" />
              <rect width="400" height="180" fill="url(#topoGrid)" />
              <circle cx="260" cy="84" r="78" fill="url(#mapGlow)" />
              <g>
                <path d="M-8 142c37-28 83-39 125-27s61 38 105 33 76-29 112-20 55 20 74 24" className="map-svg-contour faint" />
                <path d="M-4 124c36-27 79-33 115-19s61 34 102 28 78-30 112-18 51 23 78 26" className="map-svg-contour" />
                <path d="M18 108c32-23 66-26 93-11s52 29 86 22 65-27 98-12 55 22 91 23" className="map-svg-contour faint" />
                <path d="M46 90c26-16 55-19 82-4s43 23 71 14 50-20 80-8 53 20 94 17" className="map-svg-contour" />
                <path d="M86 70c19-13 49-11 68 4s32 18 57 13 41-15 63-4 39 14 70 14" className="map-svg-contour faint" />
                <path d="M118 54c22-11 44-3 62 9s40 11 55 3 42-9 66-1" className="map-svg-contour" />
              </g>
              <g>
                <path d="M38 90 74 84 98 60 136 66 157 90 201 103 231 93 266 84 304 66 348 69" className="map-svg-route" />
                <path d="M136 66 158 38 181 31 193 52 178 73" className="map-svg-route" strokeDasharray="2 5" opacity=".55" />
              </g>
              <g>
                <circle cx="38" cy="90" r="3" className="map-marker" />
                <circle cx="38" cy="90" r="8" className="map-marker-ring" />
                <circle cx="231" cy="93" r="2.5" fill="#ff6247" />
                <circle cx="231" cy="93" r="7" fill="none" stroke="#ff6247" opacity=".45" />
                <rect x="263" y="80" width="7" height="7" transform="rotate(45 266.5 83.5)" fill="none" stroke="#c8f45c" opacity=".8" />
                <path d="M266 70v-8M266 96v8M253 84h-8M279 84h8" stroke="#c8f45c" opacity=".36" />
                <circle cx="348" cy="69" r="2" fill="#919d8b" />
                <text x="43" y="84" className="map-svg-label">FOB / YOU</text>
                <text x="238" y="88" className="map-svg-label" style={{ fill: "#ff7862" }}>CONTACT</text>
                <text x="272" y="78" className="map-svg-label hot">RELAY 04-C</text>
                <text x="337" y="62" className="map-svg-label">EXFIL</text>
                <text x="112" y="57" className="map-svg-label">RIDGE / 72M</text>
                <text x="26" y="156" className="map-svg-label">GRID 03 / TRENCH</text>
                <text x="308" y="150" className="map-svg-label">SECTOR EDGE</text>
              </g>
            </svg>
            <span className="map-scan" />
            <span className="map-coordinate">34° 07' 22 N / 118° 44' 18 W</span>
            <span className="map-note">Satellite overlay / passive scan</span>
          </div>
          <div className="map-foot">
            <span><i className="legend-dot" /> FIRETEAM</span>
            <span><i className="legend-dot enemy" /> CONTACT</span>
            <span><i className="legend-dot muted" /> RELAY</span>
            <span className="accent">RANGE 240M</span>
          </div>
        </div>
      );
    }

    function SquadCard() {
      const squad = [
        { id: "01", call: "GHOST-01", role: "SHOCK LEAD", hp: 94, state: "OK" },
        { id: "02", call: "VEX-07", role: "YOU / ASSAULT", hp: 74, state: "OK", you: true },
        { id: "03", call: "MOTH-03", role: "RECON", hp: 63, state: "WARN", tone: "amber" },
        { id: "04", call: "RIME-02", role: "SUPPORT", hp: 31, state: "LOW", tone: "red" }
      ];
      return (
        <div className="intel-card squad-card">
          <div className="intel-head">
            <span>SQUAD LINK</span>
            <b>04 / 04</b>
          </div>
          <div className="squad-list">
            {squad.map((member) => (
              <div className="squad-row" key={member.id}>
                <span className="squad-id">{member.id}</span>
                <div className="squad-copy">
                  <b>{member.call}</b>
                  {member.you && <span className="squad-you">YOU</span>}
                  <small>{member.role}</small>
                </div>
                <div className="squad-health" aria-label={`${member.call} health ${member.hp}%`}>
                  <span className={member.tone || ""} style={{ width: `${member.hp}%` }} />
                </div>
                <span className={`squad-state ${member.tone || ""}`}>{member.state}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    function PipelineCard() {
      return (
        <div className="intel-card pipeline-card">
          <div className="intel-head">
            <span>INTERFACE CORE</span>
            <b className="accent">ISOLATED</b>
          </div>
          <div className="pipeline-row"><span>FIELD RENDER</span><b>THREE.JS / 60FPS</b></div>
          <div className="pipeline-row"><span>STATE BRIDGE</span><b className="ok">ZUSTAND / SCOPED</b></div>
          <div className="pipeline-row"><span>HUD COMMITS</span><b>SELECTOR ONLY</b></div>
          <div className="pipeline-row"><span>FRAME COUPLING</span><b className="ok">0.00 MS</b></div>
          <div className="pipeline-wave" aria-hidden="true">
            {Array.from({ length: 25 }, (_, index) => <i key={index} />)}
          </div>
          <div className="pipeline-note">
            <span>DOM UI / EVENT DRIVEN</span>
            <b>NO JITTER</b>
          </div>
        </div>
      );
    }

    function DefectDialog({ onClose }) {
      const faction = useGameStore((state) => state.faction);
      const defectFaction = useGameStore((state) => state.defectFaction);
      const destination = faction === FACTION_A ? FACTION_B : FACTION_A;

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
      }, [onClose]);

      const confirm = () => {
        defectFaction();
        onClose();
      };

      return (
        <div className="dialog-scrim" onClick={onClose} role="presentation">
          <div className="tactical-dialog" role="dialog" aria-modal="true" aria-labelledby="defect-title" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-topline">
              <span>COMMAND OVERRIDE / FACTION TRANSFER</span>
              <span className="dialog-warning-icon"><UiIcon name="alert" size={14} /></span>
            </div>
            <h2 id="defect-title">Defect to<br />faction</h2>
            <p>This transfer is logged with command and cannot be reversed in the field. Your kit moves with you. Your current squad link will be severed, and your former faction's assets will be marked hostile.</p>
            <div className="faction-swap">
              <div className="faction-box">
                <small>CURRENT</small>
                <b>{faction}</b>
              </div>
              <span className="faction-arrow" aria-hidden="true"><UiIcon name="arrow" size={12} /></span>
              <div className="faction-box destination">
                <small>DESTINATION</small>
                <b>{destination}</b>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn" onClick={onClose}>CANCEL</button>
              <button className="dialog-btn confirm" onClick={confirm}>CONFIRM DEFECTION</button>
            </div>
          </div>
        </div>
      );
    }

    const MainMenu = React.memo(function MainMenu() {
      const openScreen = useGameStore((state) => state.openScreen);
      const resume = useGameStore((state) => state.resume);
      const quitToTitle = useGameStore((state) => state.quitToTitle);
      const faction = useGameStore((state) => state.faction);
      const [defectOpen, setDefectOpen] = useState(false);

      return (
        <section className="screen menu-screen" aria-label="Tactical pause menu">
          <div className="menu-topline">
            <span className="kicker"><span className="live-dot danger pulse" /> OPERATION SUSPENDED <span className="slash">//</span> SESSION 0x2E7A</span>
            <span className="topline-meta"><span>LINK</span> <b>SECURE</b> <span className="footer-sep" /> 24MS</span>
          </div>

          <div className="menu-grid">
            <div className="menu-primary">
              <div className="pause-label">TACTICAL HOLD <span className="slash">//</span> SIMULATION PAUSED</div>
              <h1 className="pause-title">PAUSED<span className="pause-accent">.</span></h1>
              <div className="operation-line">
                <b>OPERATION BLACK MERIDIAN</b>
                <span>KARST-9 / GRID 04-C</span>
              </div>

              <div className="mission-meta">
                <div className="meta-cell"><span>DEPLOYMENT</span><strong>04:12:38</strong></div>
                <div className="meta-cell"><span>OBJECTIVE</span><strong className="accent">RELAY 04-C</strong></div>
                <div className="meta-cell"><span>FACTION</span><MenuFaction /></div>
              </div>

              <nav className="menu-actions" aria-label="Main menu actions">
                <button className="menu-action is-primary" onClick={resume}>
                  <span className="action-number">01</span>
                  <span className="action-icon"><UiIcon name="play" size={15} /></span>
                  <span className="action-copy"><strong>RESUME</strong><small>RETURN TO SECTOR / REARMED</small></span>
                  <span className="action-tail"><kbd>ESC</kbd><UiIcon name="arrow" size={12} /></span>
                </button>

                <button className="menu-action" onClick={() => openScreen("inventory")}>
                  <span className="action-number">02</span>
                  <span className="action-icon"><UiIcon name="grid" size={14} /></span>
                  <span className="action-copy"><strong>INVENTORY</strong><small><InventoryCount /></small></span>
                  <span className="action-tail"><UiIcon name="arrow" size={12} /></span>
                </button>

                <button className="menu-action" onClick={() => openScreen("settings")}>
                  <span className="action-number">03</span>
                  <span className="action-icon"><UiIcon name="sliders" size={14} /></span>
                  <span className="action-copy"><strong>SETTINGS</strong><small>INPUT / AUDIO / DISPLAY PROFILE</small></span>
                  <span className="action-tail"><UiIcon name="arrow" size={12} /></span>
                </button>

                <button className="menu-action is-danger" onClick={() => setDefectOpen(true)}>
                  <span className="action-number">04</span>
                  <span className="action-icon"><UiIcon name="flag" size={14} /></span>
                  <span className="action-copy"><strong>DEFECT TO FACTION</strong><small>LEAVE {faction} / COMMAND LOGGED</small></span>
                  <span className="action-tail"><UiIcon name="alert" size={12} /></span>
                </button>

                <button className="menu-action" onClick={quitToTitle}>
                  <span className="action-number">05</span>
                  <span className="action-icon"><UiIcon name="back" size={14} /></span>
                  <span className="action-copy"><strong>EXIT TO TITLE</strong><small>RETURN TO START MENU / SESSION PRESERVED</small></span>
                  <span className="action-tail"><UiIcon name="arrow" size={12} /></span>
                </button>
              </nav>

              <div className="objective-card">
                <div className="objective-top">
                  <span>PRIMARY OBJECTIVE</span>
                  <span className="obj-live">ACTIVE</span>
                </div>
                <div className="objective-main">
                  <span className="obj-id">01</span>
                  <div>
                    <h3>SECURE THE RELAY STATION</h3>
                    <p>Hold the ridge until exfil arrives. Do not break the line.</p>
                  </div>
                  <b>68%</b>
                </div>
                <div className="objective-track"><span style={{ width: "68%" }} /></div>
                <div className="objective-foot"><span>PHASE 02 / 03</span><span>EXFIL IN 06:42</span></div>
              </div>

              <div className="menu-hints">
                <span><kbd>ESC</kbd> RESUME</span>
                <span><kbd>↑↓</kbd> SELECT</span>
                <span className="hint-loop">HUD DECOUPLED FROM GAME LOOP</span>
              </div>
            </div>

            <aside className="intel-side" aria-label="Mission intelligence">
              <TopoMap />
              <SquadCard />
              <PipelineCard />
            </aside>
          </div>

          {defectOpen && <DefectDialog onClose={() => setDefectOpen(false)} />}
        </section>
      );
    });

    // === [UI: START_SCREEN] ===
    // The systems check below is a fast, purely cosmetic flourish (~0.4s):
    // it never disables input. START is playable from the first frame.
    const LOAD_STEPS = ["SECURE UPLINK", "FIELD FEED 04-C", "ARMORY SYNC", "SQUAD LINK", "WEAPON SYSTEMS"];

    const StartScreen = React.memo(function StartScreen() {
      const startGame = useGameStore((state) => state.startGame);
      const openScreen = useGameStore((state) => state.openScreen);
      const notify = useGameStore((state) => state.notify);
      const [multiplayerGlitch, setMultiplayerGlitch] = useState(false);
      const playRef = React.useRef(null);
      const glitchTimerRef = React.useRef(0);

      useEffect(() => {
        if (playRef.current && (!document.activeElement || document.activeElement === document.body)) {
          playRef.current.focus({ preventScroll: true });
        }
        return () => window.clearTimeout(glitchTimerRef.current);
      }, []);

      const attemptMultiplayer = () => {
        setMultiplayerGlitch(true);
        notify("MULTIPLAYER ISN'T AVAILABLE YET, ONLY BETA", "danger");
        window.clearTimeout(glitchTimerRef.current);
        glitchTimerRef.current = window.setTimeout(() => setMultiplayerGlitch(false), 900);
      };

      return (
        <div className="overlay start-overlay clean-start" role="dialog" aria-modal="true" aria-label="IRONVEIL start menu">
          <section className="clean-start-card" aria-labelledby="ironveil-title">
            <div className="clean-start-brand">
              <span>IRONVEIL</span>
              <small>FIELD BETA</small>
            </div>
            <h1 id="ironveil-title">IRONVEIL</h1>
            <p className="clean-start-sub">Karst-9 · cloud line / river valley</p>
            <nav className="clean-start-actions" aria-label="Start menu">
              <button ref={playRef} type="button" className="clean-start-btn is-primary" onClick={startGame}>
                <strong>Single Player</strong>
                <small>Deploy solo</small>
              </button>
              <button
                type="button"
                className={`clean-start-btn is-locked ${multiplayerGlitch ? "is-glitching" : ""}`}
                onClick={attemptMultiplayer}
                aria-disabled="true"
                aria-describedby="multiplayer-closed-note"
              >
                <strong className="glitch-text" data-text="Multiplayer">Multiplayer</strong>
                <small id="multiplayer-closed-note">It isn't available yet, only beta.</small>
                <span className="clean-start-lock">CLOSED</span>
              </button>
              <button type="button" className="clean-start-btn" onClick={() => openScreen("settings")}>
                <strong>Settings</strong>
                <small>Controls / audio / display</small>
              </button>
            </nav>
            <div className="clean-start-foot">
              <span>Spawn X 0 · Z 0</span>
              <span>Warthog X 18 · Z 0</span>
            </div>
          </section>
        </div>
      );
    });

    // === [UI: INVENTORY_SYSTEM] ===
    const ItemIcon = React.memo(function ItemIcon({ type }) {
      const props = {
        viewBox: "0 0 48 32", fill: "none", stroke: "currentColor",
        strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": "true", focusable: "false"
      };
      switch (type) {
        case "carbine":
          return (
            <svg {...props}>
              <path d="M3 13h18l4-3h9l2 2h8v3h-6l-3 3H21l-3 6h-5l1-8H3v-3Z" />
              <path d="M20 19v4M32 10V7h5M14 13v3M28 15h7" opacity=".65" />
              <rect x="10" y="11.5" width="6" height="2" fill="currentColor" stroke="none" opacity=".7" />
            </svg>
          );
        case "shotgun":
          return (
            <svg {...props}>
              <path d="M3 14h11l3-3h8l2 3h17v3H27l-3 2H16l-2 5H9l1-8H3v-3Z" />
              <path d="M20 17h7v3M31 14V9h10" opacity=".7" />
              <rect x="10" y="16" width="7" height="3" fill="currentColor" opacity=".25" stroke="none" />
            </svg>
          );
        case "rifle":
          return (
            <svg {...props}>
              <path d="M1 15h15l3-3h11l2 2h14v2H31l-2 3H19l-2 5h-4l1-7H1v-2Z" />
              <path d="M18 20v3M25 12V8h9v4M8 15v2" opacity=".7" />
              <rect x="28" y="9" width="8" height="2" fill="currentColor" stroke="none" opacity=".55" />
              <circle cx="34" cy="8" r="2" />
            </svg>
          );
        case "pistol":
          return (
            <svg {...props}>
              <path d="M10 8h24l4 4v4H24l-2 3h-3l1 6h-5l-1-9H10V8Z" />
              <path d="M18 12h15M13 16l-2 4M29 16h7" opacity=".6" />
              <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
            </svg>
          );
        case "helmet":
          return (
            <svg {...props}>
              <path d="M12 24c-4-2-6-6-6-11C6 7 14 3 24 3s18 4 18 10c0 5-2 9-6 11v4H12v-4Z" />
              <path d="M12 20h24M14 24v4M30 8h7M18 8h8" opacity=".65" />
              <path d="M19 16h10l2 3H17l2-3Z" fill="currentColor" stroke="none" opacity=".35" />
            </svg>
          );
        case "armor":
          return (
            <svg {...props}>
              <path d="M15 4h18l8 6-3 17h-8l-6-4-6 4H6L3 10l12-6Z" />
              <path d="M17 10h14v11H17V10ZM12 16h2M34 16h2M24 21v4" opacity=".65" />
              <path d="M19 13h10M19 17h10" opacity=".35" />
            </svg>
          );
        case "medkit":
          return (
            <svg {...props}>
              <rect x="8" y="8" width="32" height="20" rx="1" />
              <path d="M18 4h12v4M8 14h32M13 18h5M15.5 15.5v5" />
              <path d="M27 16h7M30.5 12.5v7" />
              <path d="M14 24h20" opacity=".35" />
            </svg>
          );
        case "grenade":
          return (
            <svg {...props}>
              <path d="M20 7h9l2 3h4v4h-3l2 9c0 3-3 5-8 5s-8-2-8-5l2-9h-3v-4h3V7Z" />
              <path d="M21 4h8M30 5l5-2M11 21h26M17 15v15M24 15v15M31 15v15" opacity=".5" />
              <circle cx="31" cy="3" r="2" />
            </svg>
          );
        case "drone":
          return (
            <svg {...props}>
              <rect x="18" y="12" width="12" height="9" rx="2" />
              <path d="M13 8h6M29 8h6M13 25h6M29 25h6M18 16H7M30 16h11M18 19H9M30 19h9" />
              <circle cx="11" cy="8" r="4" /><circle cx="37" cy="8" r="4" />
              <circle cx="11" cy="25" r="4" /><circle cx="37" cy="25" r="4" />
              <circle cx="24" cy="16.5" r="2" fill="currentColor" stroke="none" opacity=".8" />
            </svg>
          );
        case "ammo":
        default:
          return (
            <svg {...props}>
              <path d="M7 11h31v18H7V11ZM7 16h31" />
              <path d="M12 5h6l2 6h-8l2-6ZM21 3h6l2 8h-8l2-8ZM30 5h6l2 6h-8l2-6Z" opacity=".7" />
              <path d="M12 21h21M12 25h14" opacity=".4" />
            </svg>
          );
      }
    });

    function OperatorFigure() {
      return (
        <svg viewBox="0 0 210 330" fill="none" role="img" aria-label="Low-poly operator silhouette wearing a plate carrier and rifle">
          <defs>
            <linearGradient id="operatorBody" x1="80" y1="30" x2="145" y2="300" gradientUnits="userSpaceOnUse">
              <stop stopColor="#344335" />
              <stop offset=".55" stopColor="#202c22" />
              <stop offset="1" stopColor="#111a13" />
            </linearGradient>
            <linearGradient id="operatorArmor" x1="90" y1="92" x2="128" y2="172" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2b3a2d" />
              <stop offset="1" stopColor="#18241b" />
            </linearGradient>
          </defs>
          <g stroke="rgba(201,221,188,.19)" strokeWidth=".8">
            <polygon points="86,47 103,29 122,42 121,64 106,79 87,66" fill="url(#operatorBody)" />
            <polygon points="82,69 124,68 136,101 129,117 130,168 72,169 72,116 78,99" fill="url(#operatorBody)" />
            <polygon points="78,96 130,95 140,142 128,156 78,156 67,140 74,98" fill="url(#operatorArmor)" />
            <polygon points="74,157 128,157 126,198 139,258 111,304 87,302 70,249 82,197" fill="url(#operatorBody)" />
            <polygon points="73,169 53,176 39,228 49,237 65,198 83,184" fill="#1d2920" />
            <polygon points="128,169 148,176 161,224 150,233 137,194 122,183" fill="#1c281f" />
            <polygon points="58,175 45,184 53,213 67,207 74,185" fill="#202d23" />
            <polygon points="146,175 158,184 151,211 137,207 131,184" fill="#202d23" />
            <polygon points="74,243 89,244 93,300 77,308 66,277" fill="#162119" />
            <polygon points="103,243 118,243 124,301 108,307 97,278" fill="#1a251c" />
            <polygon points="58,303 82,302 80,312 54,311" fill="#0e1610" />
            <polygon points="96,300 121,298 123,308 94,310" fill="#0e1610" />
            <polygon points="82,169 130,169 128,182 83,183" fill="#111a13" />
            <polygon points="89,184 103,184 103,200 92,203 87,194" fill="#253328" />
            <polygon points="107,188 118,188 120,204 106,205" fill="#223026" />
          </g>
          <g transform="rotate(-17 102 133)">
            <path d="M31 128h97l8-4h26l4 3h12v5h-18l-3 3h-31l-5 7h-5l1-11h-65l-5 11h-10l2-14H31Z" fill="#152019" stroke="rgba(202,222,193,.35)" strokeWidth=".9" />
            <path d="M135 128v-7h17v7M49 139v7h19M111 135v7" stroke="rgba(200,220,190,.28)" strokeWidth=".8" />
            <path d="M95 123h19v2H95v-2Z" fill="rgba(200,244,92,.5)" />
            <path d="M141 126v-6h9v6" stroke="rgba(200,244,92,.55)" strokeWidth=".9" />
            <path d="M151 126h17v1h-17v-1Z" fill="rgba(200,220,190,.4)" />
          </g>
          <g stroke="rgba(200,244,92,.45)" strokeWidth=".7" fill="none" opacity=".85">
            <path d="M84 95h-7v-8M129 95h7v-8M84 156h-7v8M129 156h7v8" />
            <circle cx="105" cy="111" r="2" fill="rgba(200,244,92,.6)" stroke="none" />
            <path d="M105 111 121 124M105 111 91 125" opacity=".35" />
            <path d="M34 86h-11M31 78h-7M34 94h-6" opacity=".6" />
          </g>
          <g fill="rgba(202,222,193,.28)">
            <circle cx="84" cy="177" r="1.3" /><circle cx="116" cy="177" r="1.3" />
            <circle cx="61" cy="300" r="1.2" /><circle cx="112" cy="298" r="1.2" />
            <circle cx="75" cy="62" r="1" /><circle cx="124" cy="62" r="1" />
          </g>
          <path d="M92 49h21l-2 5h-19l-3-3 3-2Z" fill="rgba(200,244,92,.24)" />
          <path d="M67 140h73" stroke="rgba(200,244,92,.23)" strokeWidth=".7" />
          <path d="M86 69v10M103 69v10M120 69v10" stroke="rgba(202,222,193,.12)" strokeWidth=".7" />
          <text x="19" y="255" fill="rgba(200,220,189,.31)" fontFamily="IBM Plex Mono, monospace" fontSize="5" letterSpacing="1">VEX-07</text>
          <text x="19" y="265" fill="rgba(200,244,92,.5)" fontFamily="IBM Plex Mono, monospace" fontSize="4.5" letterSpacing=".7">ASSAULT / LIVE</text>
          <line x1="18" y1="270" x2="48" y2="270" stroke="rgba(200,244,92,.3)" strokeWidth=".7" />
        </svg>
      );
    }

    const OperatorPanel = React.memo(function OperatorPanel({ selectedId, onSelect }) {
      const equipped = useGameStore((state) => state.equipped);
      const unequipSlot = useGameStore((state) => state.unequipSlot);
      const filled = EQUIP_SLOTS.filter((slot) => equipped[slot.key]).length;

      return (
        <aside className="panel operator-panel" aria-label="Operator equipment">
          <div className="panel-title">
            <span>OPERATOR / LOADOUT</span>
            <b>VEX-07 · {String(filled).padStart(2, "0")}/05</b>
          </div>
          <div className="operator-visual">
            <span className="operator-visual-tag">UNIT <b>VANGUARD-07</b></span>
            <OperatorFigure />
            <span className="operator-visual-state">COMBAT READY</span>
          </div>
          <div className="equip-list">
            {EQUIP_SLOTS.map((slot) => {
              const itemId = equipped[slot.key];
              const item = itemId ? ITEMS[itemId] : null;
              return (
                <button
                  key={slot.key}
                  className={`equip-slot ${item ? "" : "is-empty"} ${item && selectedId === itemId ? "is-selected" : ""}`}
                  onClick={() => { if (item) onSelect(itemId); else unequipSlot(slot.key); }}
                  aria-label={item ? `${slot.label}: ${item.name}. View item.` : `${slot.label}: empty slot.`}
                >
                  <span className="equip-index">{slot.code}</span>
                  <span className="equip-icon">{item ? <ItemIcon type={item.icon} /> : <span>+</span>}</span>
                  <span className="equip-copy">
                    <small>{slot.label}</small>
                    <b>{item ? item.name : "EMPTY SLOT"}</b>
                  </span>
                  {item ? <span className="equip-mark" aria-hidden="true" /> : <span className="equip-plus" aria-hidden="true">+</span>}
                </button>
              );
            })}
          </div>
          <div className="operator-foot">
            <span className="operator-armor"><i /> ARMOR <b>76 / ACTIVE</b></span>
            <span>SIGNATURE <b>LOW</b></span>
          </div>
        </aside>
      );
    });

    const InventoryDetail = React.memo(function InventoryDetail({ selectedId, inventory, onSelect, onBack }) {
      const equipped = useGameStore((state) => state.equipped);
      const equipItem = useGameStore((state) => state.equipItem);
      const unequipSlot = useGameStore((state) => state.unequipSlot);
      const loadAmmo = useGameStore((state) => state.loadAmmo);
      const notify = useGameStore((state) => state.notify);
      const item = ITEMS[selectedId];
      const entry = inventory.find((slot) => slot && slot.id === selectedId);
      const isEquipped = Boolean(item && item.slot && equipped[item.slot] === selectedId);
      const canEquip = Boolean(item && item.slot && entry);

      if (!item) {
        return (
          <aside className="panel detail-panel" aria-label="Item details">
            <div className="detail-empty">
              <span className="detail-empty-plus">+</span>
              <b>NO ITEM SELECTED</b>
              <span>Select a field asset to inspect its loadout data.</span>
            </div>
          </aside>
        );
      }

      return (
        <aside className="panel detail-panel" id="item-detail" aria-label={`${item.name} details`}>
          <div className="detail-top">
            <span className="detail-rarity">{item.rarity}</span>
            <span className="detail-code">{item.code}</span>
          </div>
          <div className="detail-visual">
            <span className="detail-corner a" /><span className="detail-corner b" />
            <span className="detail-corner c" /><span className="detail-corner d" />
            <ItemIcon type={item.icon} />
          </div>
          <div>
            <h2 className="detail-name">{item.name}</h2>
            <div className="detail-class"><b>{item.type}</b><span>/</span><span>{item.category === "ammo" ? "RESERVE" : "FIELD ASSET"}</span></div>
            <p className="detail-desc">{item.desc}</p>
          </div>
          <div className="detail-stats">
            {Object.entries(item.stats).map(([label, value]) => (
              <div className="detail-stat-line" key={label}>
                <span>{label}</span>
                <i><span style={{ width: `${value}%` }} /></i>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <div className="detail-specs">
            <div className="detail-spec"><span>MASS</span><b>{item.weight.toFixed(1)} KG</b></div>
            <div className="detail-spec"><span>QUANTITY</span><b>{entry ? String(entry.qty).padStart(2, "0") : "00"}</b></div>
            <div className="detail-spec"><span>SLOT</span><b>{item.slot ? item.slot.toUpperCase() : "STASH"}</b></div>
            <div className="detail-spec"><span>STATUS</span><b className={isEquipped ? "accent" : ""}>{isEquipped ? "EQUIPPED" : "STOWED"}</b></div>
          </div>
          <div className="detail-actions">
            {item.category === "ammo" ? (
              <button className="btn-solid" onClick={() => loadAmmo(selectedId)} disabled={!entry}>
                {entry ? <>LOAD TO RESERVE <span>+{item.reserveAdd}</span></> : "NO STOCK AVAILABLE"}
              </button>
            ) : (
              <button className="btn-solid" onClick={() => equipItem(selectedId)} disabled={!canEquip || isEquipped}>
                {isEquipped ? `EQUIPPED TO ${item.slot.toUpperCase()}` : canEquip ? `EQUIP TO ${item.slot.toUpperCase()}` : "SLOT UNAVAILABLE"}
              </button>
            )}
            {isEquipped ? (
              <button className="btn-outline danger" onClick={() => unequipSlot(item.slot)}>UNEQUIP FROM OPERATOR</button>
            ) : (
              <button className="btn-outline" onClick={() => notify(`${item.name} // LOADOUT TELEMETRY SYNCED`)}>
                {item.category === "ammo" ? "REQUEST FULL RESUPPLY" : "COMPARE FIELD KIT"}
              </button>
            )}
            <button className="btn-ghost" onClick={onBack} style={{ alignSelf: "flex-start" }}>← RETURN TO COMMAND</button>
          </div>
        </aside>
      );
    });

    const InventoryScreen = React.memo(function InventoryScreen() {
      const inventory = useGameStore((state) => state.inventory);
      const equipped = useGameStore((state) => state.equipped);
      const goHome = useGameStore((state) => state.goHome);
      const hasStarted = useGameStore((state) => state.hasStarted);
      const sortInventory = useGameStore((state) => state.sortInventory);
      const notify = useGameStore((state) => state.notify);
      const [filter, setFilter] = useState("all");
      const [selectedId, setSelectedId] = useState("kx9");

      const filled = inventory.filter(Boolean);
      const weight = filled.reduce((total, entry) => {
        const item = ITEMS[entry.id];
        return total + item.weight * (item.category === "ammo" ? entry.qty : 1);
      }, 0);
      const weightPercent = Math.min(100, Math.round((weight / 30) * 100));
      const equippedIds = Object.values(equipped).filter(Boolean);
      const filters = [
        { id: "all", label: "ALL", count: filled.length },
        { id: "weapon", label: "WEAPONS", count: filled.filter((entry) => ITEMS[entry.id].category === "weapon").length },
        { id: "ammo", label: "AMMO", count: filled.filter((entry) => ITEMS[entry.id].category === "ammo").length },
        { id: "gear", label: "GEAR", count: filled.filter((entry) => ITEMS[entry.id].category === "gear").length }
      ];
      const filteredEntries = filled.filter((entry) => filter === "all" || ITEMS[entry.id].category === filter);
      const emptyCount = filter === "all" ? INVENTORY_SIZE - filteredEntries.length : Math.max(0, 8 - filteredEntries.length);
      const displaySlots = [...filteredEntries, ...Array(emptyCount).fill(null)];

      const handleSelect = (id) => {
        setSelectedId(id);
        if (window.innerWidth <= 860) {
          window.setTimeout(() => {
            const detail = document.getElementById("item-detail");
            if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
      };
      const handleApply = () => {
        notify("LOADOUT COMMITTED // FIELD KIT SYNCHRONIZED");
        goHome();
      };

      return (
        <section className="screen inventory-screen" aria-label="Armory and inventory">
          <div className="screen-bar">
            <button className="back-btn" onClick={goHome}>
              <UiIcon name="back" size={10} />
              {hasStarted ? "COMMAND" : "START MENU"}
            </button>
            <div className="screen-heading">
              <span className="eyebrow"><span className="live-dot" /> LOADOUT CONTROL <span className="slash">//</span> BAY 02</span>
              <h1>ARMORY<span>.</span></h1>
              <p>Select an asset to inspect it. Empty slots are dashed. Changes are live.</p>
            </div>
            <div className="screen-bar-right">
              <div className="load-stat"><span>KIT MASS</span><b>{weight.toFixed(1)} <small>/ 30 KG</small></b></div>
              <button className="btn-solid" onClick={handleApply}>
                <UiIcon name="check" size={10} />
                APPLY LOADOUT
              </button>
            </div>
          </div>

          <div className="inventory-layout">
            <OperatorPanel selectedId={selectedId} onSelect={handleSelect} />

            <section className="panel stash-panel" aria-label="Field stash">
              <div className="stash-top">
                <div>
                  <div className="stash-title">FIELD STASH</div>
                  <div className="stash-sub">AUTHORIZED ASSETS / {filter === "all" ? "FULL KIT" : filter.toUpperCase()}</div>
                </div>
                <div className="stash-slots">{String(filled.length).padStart(2, "0")} <small>/ {INVENTORY_SIZE} USED</small></div>
              </div>
              <div className="filter-row" role="group" aria-label="Filter inventory">
                {filters.map((entry) => (
                  <button
                    key={entry.id}
                    className={`filter-btn ${filter === entry.id ? "is-active" : ""}`}
                    onClick={() => setFilter(entry.id)}
                    aria-pressed={filter === entry.id}
                  >
                    {entry.label} <i>{String(entry.count).padStart(2, "0")}</i>
                  </button>
                ))}
                <span className="filter-sort">SORT / CLASS</span>
              </div>
              <div className="inventory-grid" aria-live="polite">
                {displaySlots.map((entry, index) => {
                  if (!entry) {
                    return (
                      <div className="inv-slot is-empty" key={`empty-${index}`} aria-label="Empty inventory slot">
                        <span className="inv-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="inv-icon"><span className="empty-plus">+</span></span>
                        <span className="inv-name">EMPTY SLOT</span>
                        <span className="inv-type">AVAILABLE</span>
                      </div>
                    );
                  }
                  const item = ITEMS[entry.id];
                  const isEquipped = equippedIds.includes(entry.id);
                  return (
                    <button
                      key={`${entry.id}-${index}`}
                      className={`inv-slot ${selectedId === entry.id ? "is-selected" : ""}`}
                      onClick={() => handleSelect(entry.id)}
                      aria-pressed={selectedId === entry.id}
                      aria-label={`${item.name}, quantity ${entry.qty}${isEquipped ? ", equipped" : ""}`}
                    >
                      <span className="inv-index">{String(index + 1).padStart(2, "0")}</span>
                      {entry.qty > 1 && <span className="inv-qty">×{entry.qty}</span>}
                      <span className="inv-icon"><ItemIcon type={item.icon} /></span>
                      <span className="inv-name">{item.name}</span>
                      <span className="inv-type">{item.rarity}</span>
                      {isEquipped && <span className="inv-equipped" aria-label="Equipped" />}
                    </button>
                  );
                })}
              </div>
              <div className="stash-foot">
                <span>KIT MASS <b className="accent">{weight.toFixed(1)} / 30.0 KG</b></span>
                <div className="stash-capacity">
                  <div className="stash-capacity-bar"><span style={{ width: `${weightPercent}%` }} /></div>
                  <button className="btn-ghost" onClick={sortInventory}>AUTO-SORT <span aria-hidden="true">↕</span></button>
                </div>
              </div>
            </section>

            <InventoryDetail
              selectedId={selectedId}
              inventory={inventory}
              onSelect={setSelectedId}
              onBack={goHome}
            />
          </div>
        </section>
      );
    });

    // ============ SETTINGS SYSTEM ============
    let lookSensitivitySetting = 30; // -> inputState.sensitivity 0.55
    const applyLookSensitivity = (value) => {
      lookSensitivitySetting = value;
      inputState.sensitivity = 0.25 + value * 0.01;
    };
    let adsSensitivitySetting = 26; // -> inputState.adsSensitivity 0.26 (scoped look)
    const applyAdsSensitivity = (value) => {
      adsSensitivitySetting = value;
      inputState.adsSensitivity = Math.max(0.05, Math.min(1.5, (value || 26) / 100));
    };
    applyAdsSensitivity(adsSensitivitySetting);
    let renderQualitySetting = "MED"; // preset label only: backbuffer resolution stays at native DPR
    const applyRenderQuality = (value) => {
      renderQualitySetting = value;
      inputState.quality = value;
    };
    applyRenderQuality(renderQualitySetting);
    let fovSetting = 71; // base vertical FOV; sprint/walk/wade effects add on top in world.js
    const applyFov = (value) => {
      fovSetting = Math.max(55, Math.min(100, Math.round(value) || 71));
      inputState.fov = fovSetting;
    };
    applyFov(fovSetting);
    let flightInvertPitchSetting = false; // aircraft W/S triangles + keys
    const applyFlightInvertPitch = (value) => {
      flightInvertPitchSetting = !!value;
      inputState.flightInvertPitch = flightInvertPitchSetting;
    };
    applyFlightInvertPitch(flightInvertPitchSetting);
    let flightInvertRollSetting = false; // aircraft A/D triangles + keys
    const applyFlightInvertRoll = (value) => {
      flightInvertRollSetting = !!value;
      inputState.flightInvertRoll = flightInvertRollSetting;
    };
    applyFlightInvertRoll(flightInvertRollSetting);
    const SETTINGS_DEFAULTS = {
      sensitivity: 30, adsSensitivity: 26, fov: 71, invertY: false, flightInvertPitch: false, flightInvertRoll: false, vibration: true,
      master: 78, effects: 64, comms: 55, music: 22, voiceActivation: false, muteOnFocus: true,
      quality: "MED", brightness: 58, filmGrain: true, motionBlur: false,
      hudOpacity: 86, compassTicks: true, reduceShake: true, uiMotion: true
    };

    const SETTINGS_TABS = [
      { id: "controls", label: "CONTROLS", icon: "joystick" },
      { id: "audio", label: "AUDIO", icon: "audio" },
      { id: "display", label: "DISPLAY", icon: "monitor" },
      { id: "interface", label: "INTERFACE", icon: "chip" }
    ];

    const SETTINGS_META = {
      controls: { eyebrow: "INPUT MATRIX / PROFILE 04", title: "CONTROL PROFILE", desc: "Tune stick response and field bindings. Changes apply to the local operator profile." },
      audio: { eyebrow: "SONIC MIX / FIELD HEADSET", title: "AUDIO MIX", desc: "Balance the chatter, the gunfire and everything that tells you to turn around." },
      display: { eyebrow: "OPTIC FEED / RENDER", title: "DISPLAY FEED", desc: "Frame the field. Visual options are tuned for low-latency handheld play." },
      interface: { eyebrow: "HUD INTEGRITY / DOM BRIDGE", title: "INTERFACE CORE", desc: "Adjust HUD presence and accessibility. This layer is isolated from the render loop." }
    };

    function SettingSlider({ label, hint, value, min = 0, max = 100, step = 1, unit = "%", onChange, displayValue }) {
      const id = `setting-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
      return (
        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor={id}>{label}</label>
            <small>{hint}</small>
          </div>
          <div className="setting-control">
            <div className="range-wrap">
              <input
                id={id}
                className="tac-range"
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                style={{ "--range-fill": `${fill}%` }}
                aria-label={label}
              />
              <output htmlFor={id}>{displayValue || `${value}${unit}`}</output>
            </div>
          </div>
        </div>
      );
    }

    function SettingToggle({ label, hint, value, onChange }) {
      return (
        <div className="setting-row">
          <div className="setting-copy">
            <span className="setting-label">{label}</span>
            <small>{hint}</small>
          </div>
          <div className="setting-control">
            <button
              className="toggle"
              role="switch"
              aria-checked={value}
              aria-label={label}
              onClick={() => onChange(!value)}
            />
          </div>
        </div>
      );
    }

    function SettingSection({ title, children }) {
      return (
        <div className="settings-section">
          <div className="settings-section-head">{title}</div>
          {children}
        </div>
      );
    }

    function InterfaceArchitectureCard() {
      return (
        <div className="interface-card">
          <div className="interface-head">
            <span>UI RENDER PIPELINE</span>
            <span className="tag acid">DECOUPLED</span>
          </div>
          <div className="interface-flow">
            <div className="interface-node"><small>SCENE</small><b>THREE.JS</b><span>60 FPS</span></div>
            <span className="interface-link">→</span>
            <div className="interface-node"><small>STATE</small><b>ZUSTAND</b><span>SCOPED</span></div>
            <span className="interface-link">→</span>
            <div className="interface-node"><small>HUD</small><b>REACT 18</b><span>ISOLATED</span></div>
          </div>
          <p>Store commits are event-driven. Health, ammo and compass HUD parts subscribe to their own slices — never the Three.js render loop.</p>
        </div>
      );
    }

    const SettingsScreen = React.memo(function SettingsScreen() {
      const goHome = useGameStore((state) => state.goHome);
      const hasStarted = useGameStore((state) => state.hasStarted);
      const notify = useGameStore((state) => state.notify);
      const showDebug = useGameStore((state) => state.showDebug);
      const setShowDebug = useGameStore((state) => state.setShowDebug);
      const [tab, setTab] = useState("controls");
      const [settings, setSettings] = useState(() => ({ ...SETTINGS_DEFAULTS, sensitivity: lookSensitivitySetting, adsSensitivity: adsSensitivitySetting, quality: renderQualitySetting, fov: fovSetting, flightInvertPitch: flightInvertPitchSetting, flightInvertRoll: flightInvertRollSetting }));

      const update = (key, value) => {
        if (key === "sensitivity") applyLookSensitivity(value);
        if (key === "adsSensitivity") applyAdsSensitivity(value);
        if (key === "quality") applyRenderQuality(value);
        if (key === "fov") applyFov(value);
        if (key === "flightInvertPitch") applyFlightInvertPitch(value);
        if (key === "flightInvertRoll") applyFlightInvertRoll(value);
        setSettings((current) => ({ ...current, [key]: value }));
      };
      const reset = () => {
        applyLookSensitivity(SETTINGS_DEFAULTS.sensitivity);
        applyAdsSensitivity(SETTINGS_DEFAULTS.adsSensitivity);
        applyRenderQuality(SETTINGS_DEFAULTS.quality);
        applyFov(SETTINGS_DEFAULTS.fov);
        applyFlightInvertPitch(SETTINGS_DEFAULTS.flightInvertPitch);
        applyFlightInvertRoll(SETTINGS_DEFAULTS.flightInvertRoll);
        setShowDebug(false);
        setSettings({ ...SETTINGS_DEFAULTS });
        notify("DEFAULT PROFILE RESTORED // UNSAVED CHANGES CLEARED");
      };
      const commit = () => notify("SETTINGS COMMITTED // LOCAL PROFILE SYNCHRONIZED");
      const meta = SETTINGS_META[tab];

      return (
        <section className="screen settings-screen" aria-label="System settings">
          <div className="screen-bar">
            <button className="back-btn" onClick={goHome}>
              <UiIcon name="back" size={10} />
              {hasStarted ? "COMMAND" : "START MENU"}
            </button>
            <div className="screen-heading">
              <span className="eyebrow"><span className="live-dot" /> SYSTEM CONTROL <span className="slash">//</span> LOCAL PROFILE</span>
              <h1>SETTINGS<span>.</span></h1>
              <p>Field configuration for operator VEX-07. Applied locally, synced on commit.</p>
            </div>
            <div className="screen-bar-right">
              <span className="tag acid">PROFILE / LOCAL</span>
            </div>
          </div>

          <div className="settings-layout">
            <aside className="panel settings-nav" aria-label="Settings categories">
              <div className="panel-title"><span>CONFIGURATION</span><b>04 / NODES</b></div>
              <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                {SETTINGS_TABS.map((entry, index) => (
                  <button
                    key={entry.id}
                    className={`settings-tab ${tab === entry.id ? "is-active" : ""}`}
                    onClick={() => setTab(entry.id)}
                    role="tab"
                    aria-selected={tab === entry.id}
                  >
                    <span className="tab-index">{String(index + 1).padStart(2, "0")}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <UiIcon name={entry.icon} size={11} />
                      {entry.label}
                    </span>
                    <span className="tab-arrow">›</span>
                  </button>
                ))}
              </div>
              <div className="settings-nav-foot">
                ACTIVE CHANNEL
                <b>OP / BLACK MERIDIAN</b>
                VEX-07 · LVL 24<br />
                BUILD 0.9.4 / FIELD
              </div>
            </aside>

            <div className="panel settings-panel">
              <div className="settings-panel-head">
                <div>
                  <span className="eyebrow">{meta.eyebrow}</span>
                  <h2>{meta.title}</h2>
                  <p>{meta.desc}</p>
                </div>
                <span className="tag">{tab.toUpperCase()} / 04</span>
              </div>

              {tab === "controls" && (
                <div className="settings-sections">
                  <SettingSection title="INPUT / AIM RESPONSE">
                    <SettingSlider label="LOOK SENSITIVITY" hint="Camera response across the full turn range." value={settings.sensitivity} onChange={(value) => update("sensitivity", value)} />
                    <SettingSlider label="ADS SENSITIVITY" hint="Aim-down-sights multiplier. Keep it deliberate." value={settings.adsSensitivity} onChange={(value) => update("adsSensitivity", value)} />
                    <SettingToggle label="INVERT VERTICAL AXIS" hint="Invert the camera pitch response." value={settings.invertY} onChange={(value) => update("invertY", value)} />
                    <SettingToggle label="HAPTIC FEEDBACK" hint="Short impulse on fire and damage." value={settings.vibration} onChange={(value) => update("vibration", value)} />
                  </SettingSection>
                  <SettingSection title="FIELD BINDINGS / TOUCH FIRST">
                    <div className="keybind-list">
                      <div className="keybind-row"><span>MOVE</span><span><kbd>LEFT STICK</kbd></span></div>
                      <div className="keybind-row"><span>AIM</span><span><kbd>RIGHT DRAG</kbd></span></div>
                      <div className="keybind-row"><span>ADS / SCOPE</span><span><kbd>ADS</kbd></span></div>
                      <div className="keybind-row"><span>SWAP GUN</span><span><kbd>TAP WEAPON SLOT</kbd></span></div>
                      <div className="keybind-row"><span>FIRE WEAPON</span><span><kbd>FIRE</kbd></span></div>
                      <div className="keybind-row"><span>RELOAD</span><span><kbd>RLD</kbd></span></div>
                      <div className="keybind-row"><span>CROUCH</span><span><kbd>CRCH</kbd></span></div>
                      <div className="keybind-row"><span>JUMP</span><span><kbd>JUMP</kbd></span></div>
                      <SettingToggle label="REVERSE AIRCRAFT W/S" hint="Swap the left W/S rocker and keys: W pitches down (ground: brake/reverse), S pitches up and takes off." value={settings.flightInvertPitch} onChange={(value) => update("flightInvertPitch", value)} />
                      <SettingToggle label="REVERSE AIRCRAFT A/D" hint="Swap the right A/D rocker and keys for ground steering and airborne roll." value={settings.flightInvertRoll} onChange={(value) => update("flightInvertRoll", value)} />
                      <div className="keybind-row"><span>AIRCRAFT PITCH / TAKE OFF</span><span><kbd>W ▲</kbd><kbd>S ▼</kbd></span></div>
                      <div className="keybind-row"><span>AIRCRAFT STEER / ROLL</span><span><kbd>A ◀</kbd><kbd>D ▶</kbd></span></div>
                      <div className="keybind-row"><span>AIRCRAFT THRUST</span><span><kbd>GEAR QUADRANT</kbd></span></div>
                      <div className="keybind-row"><span>LANDING GEAR · AUTO + MANUAL</span><span><kbd>B</kbd><kbd>GEAR BUTTON</kbd></span></div>
                      <div className="keybind-row"><span>AI BALANCE / AUTOPILOT / MANUAL</span><span><kbd>L</kbd><kbd>AI BUTTON</kbd></span></div>
                      <div className="keybind-row"><span>F3 DEBUG OVERLAY</span><span><kbd>F3 CHIP</kbd></span></div>
                      <div className="keybind-row"><span>COMMAND MENU</span><span><kbd>❚❚</kbd></span></div>
                    </div>
                  </SettingSection>
                </div>
              )}

              {tab === "audio" && (
                <div className="settings-sections">
                  <SettingSection title="MIX / MASTER">
                    <SettingSlider label="MASTER VOLUME" hint="Overall field mix." value={settings.master} onChange={(value) => update("master", value)} />
                    <SettingSlider label="WEAPON FX" hint="Gunfire, mechanics and impacts." value={settings.effects} onChange={(value) => update("effects", value)} />
                    <SettingSlider label="SQUAD COMMS" hint="Voice and tactical radio traffic." value={settings.comms} onChange={(value) => update("comms", value)} />
                    <SettingSlider label="MUSIC / AMBIENCE" hint="Low-frequency tension bed." value={settings.music} onChange={(value) => update("music", value)} />
                  </SettingSection>
                  <SettingSection title="RADIO / CHANNEL">
                    <SettingToggle label="VOICE ACTIVATION" hint="Open mic is not recommended in the field." value={settings.voiceActivation} onChange={(value) => update("voiceActivation", value)} />
                    <SettingToggle label="MUTE ON LOSS OF FOCUS" hint="Silence all channels when the interface pauses." value={settings.muteOnFocus} onChange={(value) => update("muteOnFocus", value)} />
                    <div className="interface-card" style={{ marginTop: 12 }}>
                      <div className="interface-head"><span>VOICE CHANNEL</span><span className="tag acid"><span className="live-dot pulse" /> LINKED</span></div>
                      <div className="pipeline-wave" aria-hidden="true">{Array.from({ length: 26 }, (_, index) => <i key={index} />)}</div>
                      <p>GHOST-01 / MOTH-03 / RIME-02 are receiving. Push-to-talk is mapped to <b style={{ color: "var(--ink-soft)" }}>V</b>.</p>
                    </div>
                  </SettingSection>
                </div>
              )}

              {tab === "display" && (
                <div className="settings-sections">
                  <SettingSection title="OPTICS / FIELD OF VIEW">
                    <SettingSlider label="FIELD OF VIEW" hint="Base view angle. Sprint stretch, walk pulse and wading push add on top, then fade with stamina." value={settings.fov} min={55} max={100} unit="°" onChange={(value) => update("fov", value)} />
                    <SettingSlider label="BRIGHTNESS" hint="Lift the shadows without losing the dark." value={settings.brightness} onChange={(value) => update("brightness", value)} />
                    <div className="setting-row">
                      <div className="setting-copy"><span className="setting-label">RENDER QUALITY</span><small>Preset applied after the next respawn.</small></div>
                      <div className="setting-control">
                        <div className="segmented" role="group" aria-label="Render quality">
                          {["LOW", "MED", "HIGH", "ULTRA"].map((level) => (
                            <button key={level} className={settings.quality === level ? "is-selected" : ""} onClick={() => update("quality", level)} aria-pressed={settings.quality === level}>{level}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </SettingSection>
                  <SettingSection title="IMAGE / EFFECTS">
                    <SettingToggle label="FILM GRAIN" hint="Keep the field feed gritty and tactile." value={settings.filmGrain} onChange={(value) => update("filmGrain", value)} />
                    <SettingToggle label="MOTION BLUR" hint="Off is recommended for target clarity." value={settings.motionBlur} onChange={(value) => update("motionBlur", value)} />
                    <div className="interface-card">
                      <div className="interface-head"><span>ESTIMATED LOAD</span><span className="tag acid">LOW</span></div>
                      <div className="pipeline-row"><span>DRAW DISTANCE</span><b>1.2 KM</b></div>
                      <div className="pipeline-row"><span>SHADOW MAP</span><b>2048 PX</b></div>
                      <div className="pipeline-row"><span>TARGET</span><b className="ok">60 FPS</b></div>
                    </div>
                  </SettingSection>
                </div>
              )}

              {tab === "interface" && (
                <div className="settings-sections">
                  <SettingSection title="HUD / PRESENCE">
                    <SettingSlider label="HUD OPACITY" hint="Panel presence against the field feed." value={settings.hudOpacity} onChange={(value) => update("hudOpacity", value)} />
                    <SettingToggle label="F3 DEBUG / PERF OVERLAY" hint="Same switch as the HUD F3 chip and the F3 key. Off keeps the mobile HUD clean." value={showDebug} onChange={(value) => setShowDebug(value)} />
                    <SettingToggle label="COMPASS TICK SCALE" hint="Show bearing ticks along the compass strip." value={settings.compassTicks} onChange={(value) => update("compassTicks", value)} />
                    <SettingToggle label="REDUCE RETICLE SHAKE" hint="Stabilize the reticle during fire and impact." value={settings.reduceShake} onChange={(value) => update("reduceShake", value)} />
                    <SettingToggle label="INTERFACE MOTION" hint="Panel transitions and field-feed animations." value={settings.uiMotion} onChange={(value) => update("uiMotion", value)} />
                  </SettingSection>
                  <SettingSection title="ARCHITECTURE / REACT 18">
                    <InterfaceArchitectureCard />
                  </SettingSection>
                </div>
              )}

              <div className="settings-actions">
                <button className="btn-outline" onClick={reset}>RESET DEFAULTS</button>
                <button className="btn-solid" onClick={commit}>
                  <UiIcon name="check" size={10} />
                  COMMIT SETTINGS
                </button>
              </div>
            </div>
          </div>
        </section>
      );
    });

    // ============ APP SHELL / EVENT BRIDGE ============
    const BoundaryWarning = React.memo(function BoundaryWarning() {
      const active = useGameStore((state) => state.isOutOfBounds);
      const hasStarted = useGameStore((state) => state.hasStarted);
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      if (!active || !hasStarted || isMenuOpen) return null;
      return (
        <div className="oob-warning" role="alert" aria-live="assertive">
          <span>WARNING</span>
          <strong>RETURN TO THE COMBAT ZONE</strong>
          <span>-5 VITALS / SEC</span>
        </div>
      );
    });

    const Toast = React.memo(function Toast() {
      const notice = useGameStore((state) => state.notice);
      const clearNotice = useGameStore((state) => state.clearNotice);

      useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => clearNotice(notice.id), 3400);
        return () => clearTimeout(timer);
      }, [notice, clearNotice]);

      if (!notice) return null;
      return (
        <div key={notice.id} className={`toast ${notice.tone === "danger" ? "is-danger" : ""}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      );
    });

    const OverlayRoot = React.memo(function OverlayRoot() {
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      const screen = useGameStore((state) => state.screen);

      if (!isMenuOpen) return null;
      if (screen === "title") return <StartScreen />;
      return (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Command interface">
          <div className="console">
            <ConsoleHeader />
            <main className="console-main">
              {screen === "inventory" && <InventoryScreen />}
              {screen === "settings" && <SettingsScreen />}
              {screen === "main" && <MainMenu />}
            </main>
            <ConsoleFooter />
          </div>
        </div>
      );
    });

    const StageHitLayer = React.memo(function StageHitLayer() {
      const dragRef = React.useRef(null);
      const adsPointerRef = React.useRef(null);
      const lastPointerFireRef = React.useRef(0);
      const handlePointerDown = (event) => {
        if (event.pointerType === "touch") return; // touch uses drag aim + ADS/FIRE buttons
        const state = useGameStore.getState();
        if (state.isMenuOpen) return;
        if (event.pointerType === "mouse" && event.button === 2) {
          // Desktop ADS: hold right mouse to scope. The held button also
          // drags the scoped view, so precision aim does not need LMB held.
          event.preventDefault();
          adsPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, buttons: event.buttons || 2 };
          inputState.adsHeld = true;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) { /* best effort */ }
          return;
        }
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // A click on the field also (re)claims keyboard focus for WASD.
        try {
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          window.focus();
        } catch (e) { /* best effort */ }
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        inputState.firing = true; // gun charges forward while the trigger is live
        lastPointerFireRef.current = performance.now();
        state.fire();
      };
      // Some browsers do not deliver a second pointerdown for LMB while RMB
      // is already held (one shared mouse pointer). The mouse-event fallback
      // below makes scoped shooting work in that chord without double-firing
      // when pointerdown did arrive.
      const handleMouseDownFallback = (event) => {
        if (event.button !== 0 || !inputState.adsHeld || dragRef.current) return;
        if (performance.now() - lastPointerFireRef.current < 250) return;
        const state = useGameStore.getState();
        if (state.isMenuOpen) return;
        const ads = adsPointerRef.current;
        dragRef.current = { id: ads ? ads.id : -999, x: event.clientX, y: event.clientY };
        inputState.firing = true;
        lastPointerFireRef.current = performance.now();
        state.fire();
      };
      const handleMouseUpFallback = (event) => {
        if (event.button !== 0 || !dragRef.current) return;
        dragRef.current = null;
        inputState.firing = false;
      };
      const handlePointerMove = (event) => {
        const drag = dragRef.current;
        const adsDrag = adsPointerRef.current;
        // Chromium reports an LMB press/release during an RMB hold as a
        // pointermove whose buttons bitmask changes (2 -> 3 -> 2), with no
        // second pointerdown at all. Translate those transitions into the
        // scoped trigger so ADS + fire works as one chord.
        if (event.pointerType === "mouse" && adsDrag && adsDrag.id === event.pointerId) {
          const prevButtons = adsDrag.buttons == null ? event.buttons : adsDrag.buttons;
          const leftWas = (prevButtons & 1) !== 0;
          const leftNow = (event.buttons & 1) !== 0;
          if (leftNow && !leftWas) handleMouseDownFallback(event);
          if (!leftNow && leftWas) handleMouseUpFallback(event);
          adsDrag.buttons = event.buttons;
        }
        const activeDrag = drag && drag.id === event.pointerId ? drag
          : adsDrag && adsDrag.id === event.pointerId ? adsDrag : null;
        if (!activeDrag) return;
        inputState.lookDX += event.clientX - activeDrag.x;
        inputState.lookDY += event.clientY - activeDrag.y;
        activeDrag.x = event.clientX;
        activeDrag.y = event.clientY;
        // Keep the other ref for the shared mouse pointer in sync so chord
        // transitions (RMB aim -> LMB fire) never jump the view.
        if (activeDrag === drag && adsDrag && adsDrag.id === event.pointerId) { adsDrag.x = event.clientX; adsDrag.y = event.clientY; }
        if (activeDrag === adsDrag && drag && drag.id === event.pointerId) { drag.x = event.clientX; drag.y = event.clientY; }
      };
      const endDrag = (event) => {
        // Mouse buttons share one pointerId: releasing LMB must not drop a
        // still-held RMB scope (and vice versa), so dispatch on the button
        // that actually changed. Pointercancel clears both.
        const isCancel = event.type === "pointercancel";
        if ((isCancel || event.button === 2) && adsPointerRef.current && adsPointerRef.current.id === event.pointerId) {
          adsPointerRef.current = null;
          inputState.adsHeld = false;
        }
        if ((isCancel || event.button === 0) && dragRef.current && dragRef.current.id === event.pointerId) {
          dragRef.current = null;
          inputState.firing = false;
        }
      };
      return (
        <div
          className="stage-hit"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onMouseDown={handleMouseDownFallback}
          onMouseUp={handleMouseUpFallback}
          onContextMenu={(event) => event.preventDefault()}
          aria-hidden="true"
        />
      );
    });

    // === [UI: TOUCH_CONTROLS] ===
    // Strictly side-isolated touch: left half is the MOVE joystick, right
    // half is a plain drag surface for aiming — deliberately NO aim
    // joystick: no base, no nub, no rate stick. The camera follows the
    // thumb's drag delta directly and stops the instant the thumb stops.
    const TouchControls = React.memo(function TouchControls() {
      const hasStarted = useGameStore((state) => state.hasStarted);
      const isMenuOpen = useGameStore((state) => state.isMenuOpen);
      const activeWeaponSlot = useGameStore((state) => state.activeWeaponSlot);
      const moveRef = React.useRef({ id: null, ox: 0, oy: 0, lx: 0, ly: 0 });
      const aimRef = React.useRef({ id: null, lx: 0, ly: 0 });
      const moveBaseRef = React.useRef(null);
      const moveNubRef = React.useRef(null);
      const fireTimerRef = React.useRef(null);
      const [crouchOn, setCrouchOn] = useState(false);
      const [adsOn, setAdsOn] = useState(false);
      const MAX = 64;

      // Drawing a different gun always drops the scope first.
      useEffect(() => {
        setAdsOn(false);
        inputState.ads = false;
      }, [activeWeaponSlot]);

      useEffect(() => () => {
        if (fireTimerRef.current) clearInterval(fireTimerRef.current);
        inputState.moveX = 0;
        inputState.moveY = 0;
        inputState.aimX = 0;
        inputState.aimY = 0;
        inputState.touchCrouch = false;
        inputState.ads = false;
        inputState.adsHeld = false;
        inputState.firing = false;
      }, []);

      if (!hasStarted || isMenuOpen) return null;

      const place = (base, nub, ox, oy, dx, dy) => {
        if (base) {
          base.style.display = "block";
          base.style.transform = `translate(${ox}px, ${oy}px) translate(-50%, -50%)`;
        }
        if (nub) {
          nub.style.display = "block";
          nub.style.transform = `translate(${ox + dx}px, ${oy + dy}px) translate(-50%, -50%)`;
        }
      };
      const hide = (base, nub) => {
        if (base) base.style.display = "none";
        if (nub) nub.style.display = "none";
      };
      // MOVE: the one and only joystick.
      const stick = moveRef.current;
      const endMove = (event) => {
        if (stick.id !== event.pointerId) return;
        stick.id = null;
        hide(moveBaseRef.current, moveNubRef.current);
        inputState.moveX = 0;
        inputState.moveY = 0;
      };
      const moveStickHandlers = {
        onPointerDown: (event) => {
          if (event.pointerType === "mouse" || stick.id !== null) return;
          if (event.clientX >= window.innerWidth * 0.5) return;
          stick.id = event.pointerId;
          stick.ox = event.clientX;
          stick.oy = event.clientY;
          stick.lx = event.clientX;
          stick.ly = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
          place(moveBaseRef.current, moveNubRef.current, stick.ox, stick.oy, 0, 0);
        },
        onPointerMove: (event) => {
          if (stick.id !== event.pointerId) return;
          if (event.clientX >= window.innerWidth * 0.5) { endMove(event); return; }
          stick.lx = event.clientX;
          stick.ly = event.clientY;
          let dx = event.clientX - stick.ox;
          let dy = event.clientY - stick.oy;
          const len = Math.hypot(dx, dy);
          if (len > MAX) { dx = (dx / len) * MAX; dy = (dy / len) * MAX; }
          place(moveBaseRef.current, moveNubRef.current, stick.ox, stick.oy, dx, dy);
          inputState.moveX = dx / MAX;
          inputState.moveY = -(dy / MAX);
        },
        onPointerUp: endMove,
        onPointerCancel: endMove,
      };

      // AIM: naked drag surface. Deltas feed lookDX/lookDY 1:1 through the
      // sensitivity curve; releasing or crossing the midline ends the drag.
      const aim = aimRef.current;
      const endAim = (event) => {
        if (aim.id !== event.pointerId) return;
        aim.id = null;
      };
      const aimDragHandlers = {
        onPointerDown: (event) => {
          if (event.pointerType === "mouse" || aim.id !== null) return;
          if (event.clientX < window.innerWidth * 0.5) return;
          aim.id = event.pointerId;
          aim.lx = event.clientX;
          aim.ly = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event) => {
          if (aim.id !== event.pointerId) return;
          if (event.clientX < window.innerWidth * 0.5) { endAim(event); return; }
          inputState.aimX = 0;
          inputState.aimY = 0;
          inputState.lookDX += event.clientX - aim.lx;
          inputState.lookDY += event.clientY - aim.ly;
          aim.lx = event.clientX;
          aim.ly = event.clientY;
        },
        onPointerUp: endAim,
        onPointerCancel: endAim,
      };

      const stopFire = () => {
        if (fireTimerRef.current) {
          clearInterval(fireTimerRef.current);
          fireTimerRef.current = null;
        }
        inputState.firing = false;
      };
      const startFire = (event) => {
        event.preventDefault();
        if (fireTimerRef.current) clearInterval(fireTimerRef.current);
        inputState.firing = true; // rifle charges forward before the first round leaves
        useGameStore.getState().fire();
        fireTimerRef.current = setInterval(() => useGameStore.getState().fire(), 135);
      };
      const toggleAds = (event) => {
        event.preventDefault();
        const next = !inputState.ads;
        inputState.ads = next;
        setAdsOn(next);
      };

      return (
        <div className="touch-controls" aria-hidden="true">
          <div className="stick-zone zone-left" {...moveStickHandlers}>
            <span className="stick-hint hint-left"><i />MOVE</span>
          </div>
          <div className="aim-drag-zone zone-right" {...aimDragHandlers} />
          <span ref={moveBaseRef} className="stick-base" />
          <span ref={moveNubRef} className="stick-nub" />
          <button
            type="button"
            className={`touch-action-btn ads-touch-btn ${adsOn ? "is-on" : ""}`}
            aria-label="Toggle aim down sights scope"
            aria-pressed={adsOn}
            onPointerDown={toggleAds}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>ADS</span><small>{adsOn ? "SCOPED" : "SCOPE"}</small>
          </button>
          <button
            type="button"
            className="fire-btn"
            aria-label="Fire weapon"
            onPointerDown={startFire}
            onPointerUp={stopFire}
            onPointerLeave={stopFire}
            onPointerCancel={stopFire}
            onContextMenu={(event) => event.preventDefault()}
          >
            <UiIcon name="target" size={22} />
            <span>FIRE</span>
          </button>
          <button
            type="button"
            className="jump-btn"
            aria-label="Jump"
            onPointerDown={(event) => { event.preventDefault(); inputState.jump = true; }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>JUMP</span>
          </button>
          <button
            type="button"
            className="touch-action-btn reload-touch-btn"
            aria-label="Reload weapon"
            onPointerDown={(event) => { event.preventDefault(); useGameStore.getState().reload(); }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>RLD</span><small>RELOAD</small>
          </button>
          <button
            type="button"
            className={`touch-action-btn crouch-touch-btn ${crouchOn ? "is-on" : ""}`}
            aria-label="Toggle crouch"
            aria-pressed={crouchOn}
            onPointerDown={(event) => {
              event.preventDefault();
              const next = !inputState.touchCrouch;
              inputState.touchCrouch = next;
              setCrouchOn(next);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>CRCH</span><small>{crouchOn ? "ON" : "CROUCH"}</small>
          </button>
        </div>
      );
    });

    function App() {
      useEffect(() => {
        const onKeyDown = (event) => {
          const state = useGameStore.getState();
          if (event.key === "Escape") {
            event.preventDefault();
            state.handleEscape();
            return;
          }
          const pressed = event.key.toLowerCase();
          if (pressed === "m") {
            const m = sfx.setMuted(!sfx.isMuted());
            state.notify(m ? "AUDIO MUTED // M TO RESTORE" : "AUDIO LIVE // FIELD MIX ON");
            return;
          }
          if (pressed === "t") {
            inputState.timeSkip = true;
            state.notify("TIME SHIFT // +3H");
            return;
          }
          if (state.isMenuOpen) return;
          if (event.code === "Space") {
            event.preventDefault();
            inputState.jump = true; // world also tracks Space via its key set
          } else if (pressed === "1") {
            state.swapWeapon("primary");
          } else if (pressed === "2") {
            state.swapWeapon("secondary");
          } else if (pressed === "r") {
            state.reload();
          } else if (pressed === "h") {
            state.heal(18);
          }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, []);

      // Audio: unlock on first gesture; store-driven one-shots.
      useEffect(() => {
        const unlock = () => sfx.unlock();
        window.addEventListener("pointerdown", unlock);
        window.addEventListener("keydown", unlock);
        let firstMenuToggle = true;
        const unsubscribe = gameStore.subscribe((state, prev) => {
          if (state.shots > prev.shots) sfx.shot();
          if (state.ammo > prev.ammo
            && state.activeWeaponSlot === prev.activeWeaponSlot
            && state.equipped[state.activeWeaponSlot] === prev.equipped[prev.activeWeaponSlot]) sfx.reload();
          if (state.health > prev.health) sfx.heal();
          if (state.hasStarted && !prev.hasStarted) sfx.deploy();
          if (
            state.notice &&
            state.notice.id !== (prev.notice && prev.notice.id) &&
            state.notice.text.includes("MAGAZINE EMPTY")
          ) sfx.dry();
          if (state.isMenuOpen !== prev.isMenuOpen) {
            if (firstMenuToggle) firstMenuToggle = false;
            else sfx.whoosh();
          }
        });
        return () => {
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
          unsubscribe();
        };
      }, []);

      return (
        <div className="app">
          <DebugOverlay />
          <WorldScene />
          <StageHitLayer />
          <ScopeOverlay />
          <TouchControls />
          <AircraftInterface />
          <TankInterface />
          <GameHUD />
          <DeathOverlay />
          <BoundaryWarning />
          <OverlayRoot />
          <Toast />
        </div>
      );
    }

    const root = createRoot(document.getElementById("app"));
    root.render(<App />);
  
