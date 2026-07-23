// src/ui/menus/autoFeed.ts
// UI only: master toggle, per-species crop/threshold/mutation-exclusion
// config, and a live status list of currently active pets.

import { Menu } from "../menu";
import { AutoFeedService, TROUGH_CAPACITY, type AutoFeedSpeciesConfig } from "../../services/autoFeed";
import { PetsService } from "../../services/pets";
import { Atoms } from "../../store/atoms";
import { petCatalog, plantCatalog, mutationCatalog } from "../../data";
import { attachSpriteIcon } from "../spriteIconCache";

export function renderAutoFeedMenu(root: HTMLElement) {
  const ui = new Menu({ id: "auto-feed", compact: true, windowSelector: ".qws-win" });
  ui.mount(root);
  ui.addTab("main", "🍽️ Auto Feed", (view) => renderAutoFeedTab(view, ui));
}

function renderAutoFeedTab(view: HTMLElement, ui: Menu) {
  view.innerHTML = "";

  const masterCard = ui.card("🍽️ Auto Feed", {
    subtitle: "Automatically keeps the feeding trough stocked from your crop inventory.",
  });
  view.appendChild(masterCard.root);

  const masterRow = document.createElement("label");
  Object.assign(masterRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  } as CSSStyleDeclaration);

  const masterSwitch = ui.switch(AutoFeedService.isMasterEnabled()) as HTMLInputElement;
  masterSwitch.addEventListener("change", () => {
    AutoFeedService.setMasterEnabled(masterSwitch.checked);
  });

  const masterLabel = document.createElement("span");
  masterLabel.textContent = "Enable Auto Feed";
  masterLabel.style.fontSize = "13px";

  masterRow.append(masterSwitch, masterLabel);
  masterCard.body.appendChild(masterRow);

  const capNote = document.createElement("div");
  capNote.style.opacity = "0.7";
  capNote.style.fontSize = "12px";
  capNote.style.marginTop = "6px";
  capNote.textContent = `The trough holds ${TROUGH_CAPACITY} crops total across all species — restock targets below are checked against that shared cap.`;
  masterCard.body.appendChild(capNote);

  const statusCard = ui.card("Active pets", {
    subtitle: "Auto Feed only restocks the trough for species currently in your active slots.",
  });
  view.appendChild(statusCard.root);

  const statusList = document.createElement("div");
  Object.assign(statusList.style, { display: "flex", flexDirection: "column", gap: "6px" } as CSSStyleDeclaration);
  statusCard.body.appendChild(statusList);

  function renderStatusList(activeSpecies: Set<string>) {
    statusList.innerHTML = "";
    if (!activeSpecies.size) {
      const empty = document.createElement("div");
      empty.textContent = "No active pets.";
      empty.style.opacity = "0.7";
      empty.style.fontSize = "12px";
      statusList.appendChild(empty);
      return;
    }

    for (const species of activeSpecies) {
      const cfg = AutoFeedService.getSpeciesConfig(species);
      const petName = String((petCatalog as Record<string, any>)[species]?.name || species);
      const cropName = cfg.crop
        ? String((plantCatalog as Record<string, any>)[cfg.crop]?.name || cfg.crop)
        : null;

      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "20px 1fr auto",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
      } as CSSStyleDeclaration);

      const icon = document.createElement("div");
      Object.assign(icon.style, { width: "20px", height: "20px" } as CSSStyleDeclaration);
      attachSpriteIcon(icon, ["pet"], species, 20, "auto-feed-status");

      const label = document.createElement("div");
      if (!cfg.enabled || !cfg.crop) {
        label.textContent = `${petName} — not configured`;
        label.style.opacity = "0.6";
      } else {
        const count = AutoFeedService.getTroughCountForCrop(cfg.crop);
        label.textContent = `${petName} — ${cropName} (${count}/${cfg.restockTo} in trough)`;
      }

      const jumpBtn = ui.btn("Configure", { onClick: () => vtabsRef?.select(species) });
      jumpBtn.style.fontSize = "11px";
      jumpBtn.style.padding = "2px 8px";

      row.append(icon, label, jumpBtn);
      statusList.appendChild(row);
    }
  }

  let vtabsRef: ReturnType<Menu["vtabs"]> | null = null;

  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
    gap: "10px",
    alignItems: "stretch",
    height: "54vh",
    minHeight: "0",
    marginTop: "10px",
  } as CSSStyleDeclaration);
  view.appendChild(wrap);

  const left = document.createElement("div");
  Object.assign(left.style, { display: "flex", flexDirection: "column", height: "100%", minHeight: "0" } as CSSStyleDeclaration);
  wrap.appendChild(left);

  const vtabs = ui.vtabs({
    emptyText: "No pet species found.",
    fillAvailableHeight: true,
    renderItem: (item, btn) => {
      btn.innerHTML = "";
      btn.style.gridTemplateColumns = "24px 1fr auto";
      btn.style.gap = "10px";

      const size = 22;
      const iconWrap = document.createElement("div");
      Object.assign(iconWrap.style, {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "6px",
        background: "#161b22",
        border: "1px solid #ffffff10",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        fontSize: "11px",
        color: "#e2e8f0",
      } as CSSStyleDeclaration);
      const label = String(item.title || "Pet");
      iconWrap.textContent = label.charAt(0).toUpperCase();
      attachSpriteIcon(iconWrap, ["pet"], item.id, size, "auto-feed-list", {
        onNoSpriteFound: () => { iconWrap.textContent = label.charAt(0).toUpperCase(); },
      });

      const titleEl = document.createElement("div");
      titleEl.textContent = label;
      Object.assign(titleEl.style, { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as CSSStyleDeclaration);

      const statusDot = document.createElement("span");
      const cfg = AutoFeedService.getSpeciesConfig(item.id);
      statusDot.textContent = cfg.enabled && cfg.crop ? "●" : "";
      statusDot.style.color = "#4ade80";
      statusDot.style.fontSize = "10px";

      btn.append(iconWrap, titleEl, statusDot);
    },
  });
  vtabs.root.style.flex = "1 1 auto";
  vtabs.root.style.minHeight = "0";
  left.appendChild(vtabs.root);
  vtabsRef = vtabs;

  const right = document.createElement("div");
  Object.assign(right.style, { display: "flex", flexDirection: "column", gap: "10px", minHeight: "0" } as CSSStyleDeclaration);
  wrap.appendChild(right);

  const card = document.createElement("div");
  Object.assign(card.style, {
    border: "1px solid #4445",
    borderRadius: "10px",
    padding: "10px",
    background: "#0f1318",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minHeight: "0",
    overflow: "auto",
  } as CSSStyleDeclaration);
  right.appendChild(card);

  type SpeciesItem = { id: string; title: string };
  const speciesItems: SpeciesItem[] = Object.keys(petCatalog as Record<string, any>).map((species) => {
    const entry = (petCatalog as Record<string, any>)[species];
    return { id: species, title: String(entry?.name || species) };
  });
  vtabs.setItems(speciesItems);
  if (speciesItems.length) vtabs.select(speciesItems[0].id);

  function renderSpeciesConfig(species: string | null) {
    card.innerHTML = "";
    if (!species) {
      const empty = document.createElement("div");
      empty.textContent = "Select a pet species to configure.";
      empty.style.opacity = "0.75";
      card.appendChild(empty);
      return;
    }

    const cfg = AutoFeedService.getSpeciesConfig(species);
    const compatibleCrops = PetsService.getCompatibleCropsForSpecies(species) ?? [];

    const enabledRow = document.createElement("label");
    Object.assign(enabledRow.style, { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" } as CSSStyleDeclaration);
    const enabledSwitch = ui.switch(cfg.enabled) as HTMLInputElement;
    const enabledLabel = document.createElement("span");
    enabledLabel.textContent = "Auto-restock for this species";
    enabledLabel.style.fontSize = "13px";
    enabledRow.append(enabledSwitch, enabledLabel);
    card.appendChild(enabledRow);

    if (!compatibleCrops.length) {
      const empty = document.createElement("div");
      empty.textContent = "No compatible crops known for this pet.";
      empty.style.opacity = "0.75";
      card.appendChild(empty);
      return;
    }

    const cropRow = document.createElement("div");
    Object.assign(cropRow.style, { display: "flex", flexDirection: "column", gap: "4px" } as CSSStyleDeclaration);
    const cropLabel = document.createElement("div");
    cropLabel.textContent = "Assigned food (diet-restricted)";
    cropLabel.style.fontSize = "12px";
    cropLabel.style.opacity = "0.8";

    const cropSelect = ui.select({ placeholder: "Select a crop..." });
    const cropEntries = compatibleCrops
      .map((crop) => ({ crop, name: String((plantCatalog as Record<string, any>)[crop]?.name || crop) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const { crop, name } of cropEntries) {
      const opt = document.createElement("option");
      opt.value = crop;
      opt.textContent = name;
      if (crop === cfg.crop) opt.selected = true;
      cropSelect.appendChild(opt);
    }
    cropRow.append(cropLabel, cropSelect);
    card.appendChild(cropRow);

    const thresholdRow = document.createElement("div");
    Object.assign(thresholdRow.style, { display: "flex", flexDirection: "column", gap: "4px" } as CSSStyleDeclaration);
    const thresholdLabel = document.createElement("div");
    thresholdLabel.textContent = `Keep this many in the trough (0-${TROUGH_CAPACITY})`;
    thresholdLabel.style.fontSize = "12px";
    thresholdLabel.style.opacity = "0.8";
    const thresholdInput = ui.inputNumber(0, TROUGH_CAPACITY, 1, cfg.restockTo) as HTMLInputElement & { wrap: HTMLElement };
    thresholdRow.append(thresholdLabel, thresholdInput.wrap);
    card.appendChild(thresholdRow);

    const mutationRow = document.createElement("div");
    Object.assign(mutationRow.style, { display: "flex", flexDirection: "column", gap: "4px" } as CSSStyleDeclaration);
    const mutationLabel = document.createElement("div");
    mutationLabel.textContent = "Never pull these mutations from inventory";
    mutationLabel.style.fontSize = "12px";
    mutationLabel.style.opacity = "0.8";
    mutationRow.appendChild(mutationLabel);

    const mutationChips = document.createElement("div");
    Object.assign(mutationChips.style, { display: "flex", flexWrap: "wrap", gap: "6px" } as CSSStyleDeclaration);
    const excludedMutations = new Set(cfg.excludeMutations);
    const mutationNames = Object.keys(mutationCatalog as Record<string, any>);
    for (const mutation of mutationNames) {
      const chip = document.createElement("label");
      Object.assign(chip.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        padding: "3px 8px",
        borderRadius: "999px",
        border: "1px solid #ffffff22",
        cursor: "pointer",
      } as CSSStyleDeclaration);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = excludedMutations.has(mutation);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) excludedMutations.add(mutation);
        else excludedMutations.delete(mutation);
        persist();
      });
      const name = String((mutationCatalog as Record<string, any>)[mutation]?.name || mutation);
      const text = document.createElement("span");
      text.textContent = name;
      chip.append(checkbox, text);
      mutationChips.appendChild(chip);
    }
    mutationRow.appendChild(mutationChips);
    card.appendChild(mutationRow);

    const capWarning = document.createElement("div");
    Object.assign(capWarning.style, { fontSize: "12px", color: "#f87171", display: "none" } as CSSStyleDeclaration);
    card.appendChild(capWarning);

    const liveCount = document.createElement("div");
    Object.assign(liveCount.style, { fontSize: "12px", opacity: "0.75" } as CSSStyleDeclaration);
    card.appendChild(liveCount);

    function refreshLiveCount() {
      const crop = cropSelect.value || null;
      if (!crop) { liveCount.textContent = ""; return; }
      const count = AutoFeedService.getTroughCountForCrop(crop);
      liveCount.textContent = `Currently in trough: ${count}`;
    }
    refreshLiveCount();
    const liveTimer = window.setInterval(refreshLiveCount, 2000);
    const stopObserver = new MutationObserver(() => {
      if (!card.isConnected) { window.clearInterval(liveTimer); stopObserver.disconnect(); }
    });
    stopObserver.observe(document.body, { childList: true, subtree: true });

    function persist() {
      const restockTo = Number(thresholdInput.value) || 0;
      const crop = cropSelect.value || null;
      const exceeds = crop ? AutoFeedService.wouldExceedCap(species!, restockTo) : false;
      capWarning.style.display = exceeds ? "block" : "none";
      capWarning.textContent = exceeds
        ? `This would put your configured totals above the trough's ${TROUGH_CAPACITY}-crop cap.`
        : "";

      const next: Partial<AutoFeedSpeciesConfig> = {
        enabled: enabledSwitch.checked,
        crop,
        restockTo,
        excludeMutations: Array.from(excludedMutations),
      };
      const applied = AutoFeedService.setSpeciesConfig(species!, next);
      // If the crop got rejected (not in diet), reflect that back in the select.
      if (applied.crop !== crop) cropSelect.value = applied.crop || "";
      refreshLiveCount();
      vtabs.setItems(speciesItems); // refresh status dots
      renderStatusList(AutoFeedService.getActiveSpecies());
    }

    enabledSwitch.addEventListener("change", persist);
    cropSelect.addEventListener("change", persist);
    thresholdInput.addEventListener("change", persist);
  }

  vtabs.onSelect((id) => renderSpeciesConfig(id));
  renderSpeciesConfig(speciesItems[0]?.id ?? null);

  renderStatusList(AutoFeedService.getActiveSpecies());
  void AutoFeedService.onActiveSpeciesChangeNow((active) => renderStatusList(active));

  const statusTimer = window.setInterval(() => {
    renderStatusList(AutoFeedService.getActiveSpecies());
  }, 2000);
  const statusStopObserver = new MutationObserver(() => {
    if (!view.isConnected) {
      window.clearInterval(statusTimer);
      statusStopObserver.disconnect();
    }
  });
  statusStopObserver.observe(document.body, { childList: true, subtree: true });
}
