/* Meal Planner PWA
   - Loads default seed from data.json
   - Persists all edits to localStorage as the "data.json" equivalent
   - Grocery checklist is volatile (not stored)
*/

const MP = (() => {
  const STORAGE_KEY = "mealPlanner:data";
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function toast(msg) {
    const host = document.getElementById("toastHost");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity .25s ease";
      setTimeout(() => el.remove(), 260);
    }, 1600);
  }

  function safeParseJson(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function normalizeData(data) {
    // Ensure the structure exists and is usable.
    const out = data && typeof data === "object" ? data : {};
    if (!Array.isArray(out.recipes)) out.recipes = [];
    if (!Array.isArray(out.Meals)) out.Meals = ["","","","","","",""];
    if (out.Meals.length !== 7) {
      const fixed = ["","","","","","",""];
      for (let i = 0; i < Math.min(7, out.Meals.length); i++) fixed[i] = String(out.Meals[i] ?? "");
      out.Meals = fixed;
    }

    // Normalize recipes
    out.recipes = out.recipes
      .filter(r => r && typeof r === "object")
      .map(r => ({
        name: String(r.name ?? "").trim(),
        ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(x => String(x ?? "").trim()).filter(Boolean) : [],
        steps: Array.isArray(r.steps) ? r.steps.map(x => String(x ?? "").trim()).filter(Boolean) : []
      }))
      .filter(r => r.name.length > 0);

    // De-duplicate recipe names (keep first)
    const seen = new Set();
    out.recipes = out.recipes.filter(r => {
      const key = r.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return out;
  }

  async function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = safeParseJson(raw);
      if (p.ok) return normalizeData(p.value);
      // corrupted localStorage -> fall back to seed
      localStorage.removeItem(STORAGE_KEY);
    }

    // First run: load bundled data.json
    const resp = await fetch("data.json", { cache: "no-store" });
    const data = normalizeData(await resp.json());
    saveData(data);
    return data;
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data), null, 2));
  }

  async function resetToSeed() {
    localStorage.removeItem(STORAGE_KEY);
    const data = await loadData();
    return data;
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function recipeNames(data) {
    return data.recipes.map(r => r.name).sort((a,b) => a.localeCompare(b));
  }

  function findRecipe(data, name) {
    if (!name) return null;
    const key = name.toLowerCase();
    return data.recipes.find(r => r.name.toLowerCase() === key) || null;
  }

  function initPWA() {
    // Service worker
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }

  // ------------------ Plan page ------------------
  async function pagePlanInit() {
    const weekList = document.getElementById("weekList");
    const exportBtn = document.getElementById("exportBtn");
    const importFile = document.getElementById("importFile");
    const resetBtn = document.getElementById("resetBtn");

    let data = await loadData();

    function render() {
      weekList.innerHTML = "";
      const names = recipeNames(data);

      for (let i = 0; i < 7; i++) {
        const row = document.createElement("div");
        row.className = "dayRow";

        const day = document.createElement("div");
        day.className = "dayName";
        day.textContent = DAYS[i];

        const meal = document.createElement("div");
        meal.className = "dayMeal";
        meal.textContent = data.Meals[i] ? data.Meals[i] : "—";

        const select = document.createElement("select");
        select.className = "select";

        // blank option
        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "(No dinner planned)";
        select.appendChild(opt0);

        for (const n of names) {
          const opt = document.createElement("option");
          opt.value = n;
          opt.textContent = n;
          select.appendChild(opt);
        }

        select.value = data.Meals[i] || "";
        select.addEventListener("change", () => {
          data.Meals[i] = select.value;
          saveData(data);
          meal.textContent = data.Meals[i] ? data.Meals[i] : "—";
          toast("Saved");
        });

        row.appendChild(day);
        row.appendChild(meal);
        row.appendChild(select);
        weekList.appendChild(row);
      }
    }

    render();

    exportBtn?.addEventListener("click", () => {
      downloadJson("data.json", data);
      toast("Exported data.json");
    });

    importFile?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const parsed = safeParseJson(text);
      if (!parsed.ok) {
        toast("Import failed: invalid JSON");
        e.target.value = "";
        return;
      }
      data = normalizeData(parsed.value);
      saveData(data);
      render();
      toast("Imported");
      e.target.value = "";
    });

    resetBtn?.addEventListener("click", async () => {
      data = await resetToSeed();
      render();
      toast("Reset to bundled data.json");
    });
  }

  // ------------------ Recipes page ------------------
  async function pageRecipesInit() {
    const listEl = document.getElementById("recipeList");
    const searchEl = document.getElementById("recipeSearch");
    const newBtn = document.getElementById("newRecipeBtn");

    const nameEl = document.getElementById("recipeName");
    const ingEl = document.getElementById("ingredients");
    const stepsEl = document.getElementById("steps");
    const addIngBtn = document.getElementById("addIngredientBtn");
    const addStepBtn = document.getElementById("addStepBtn");
    const saveBtn = document.getElementById("saveRecipeBtn");
    const delBtn = document.getElementById("deleteRecipeBtn");

    let data = await loadData();
    let selectedIndex = data.recipes.length ? 0 : -1;
    let draft = null; // {name, ingredients[], steps[]}

    function currentRecipe() {
      if (selectedIndex < 0 || selectedIndex >= data.recipes.length) return null;
      return data.recipes[selectedIndex];
    }

    function setDraftFromRecipe(r) {
      if (!r) {
        draft = { name: "", ingredients: [], steps: [] };
      } else {
        draft = {
          name: r.name,
          ingredients: [...r.ingredients],
          steps: [...r.steps]
        };
      }
    }

    function filteredRecipes() {
      const q = (searchEl.value || "").trim().toLowerCase();
      if (!q) return data.recipes.map((r, idx) => ({ r, idx }));
      return data.recipes
        .map((r, idx) => ({ r, idx }))
        .filter(x => x.r.name.toLowerCase().includes(q));
    }

    function renderList() {
      listEl.innerHTML = "";
      const items = filteredRecipes();

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "muted small";
        empty.textContent = "No recipes found.";
        listEl.appendChild(empty);
        return;
      }

      for (const { r, idx } of items) {
        const item = document.createElement("div");
        item.className = "listItem";
        if (idx === selectedIndex) item.style.outline = "2px solid rgba(124,92,255,.55)";

        const left = document.createElement("div");
        left.textContent = r.name;

        const right = document.createElement("div");
        right.className = "badge";
        right.textContent = `${r.ingredients.length} items`;

        item.appendChild(left);
        item.appendChild(right);

        item.addEventListener("click", () => {
          // discard draft changes unless saved (intentional: simple mental model)
          selectedIndex = idx;
          setDraftFromRecipe(currentRecipe());
          renderAll();
        });

        listEl.appendChild(item);
      }
    }

    function renderDraft() {
      nameEl.value = draft?.name ?? "";

      // ingredients
      ingEl.innerHTML = "";
      if (!draft.ingredients.length) {
        const hint = document.createElement("div");
        hint.className = "muted small";
        hint.textContent = "No ingredients yet.";
        ingEl.appendChild(hint);
      }
      draft.ingredients.forEach((val, i) => {
        const row = document.createElement("div");
        row.className = "stackItem";

        const input = document.createElement("input");
        input.className = "input";
        input.value = val;
        input.placeholder = "ingredient…";
        input.addEventListener("input", () => {
          draft.ingredients[i] = input.value;
        });

        const del = document.createElement("button");
        del.className = "iconBtn iconBtn--danger";
        del.textContent = "✕";
        del.title = "Delete ingredient";
        del.addEventListener("click", () => {
          draft.ingredients.splice(i, 1);
          renderDraft();
        });

        row.appendChild(input);
        row.appendChild(del);
        ingEl.appendChild(row);
      });

      // steps
      stepsEl.innerHTML = "";
      if (!draft.steps.length) {
        const hint = document.createElement("div");
        hint.className = "muted small";
        hint.textContent = "No steps yet.";
        stepsEl.appendChild(hint);
      }
      draft.steps.forEach((val, i) => {
        const row = document.createElement("div");
        row.className = "stackItem";

        const input = document.createElement("input");
        input.className = "input stepBox";
        input.value = val;
        input.placeholder = `Step ${i + 1}…`;
        input.addEventListener("input", () => {
          draft.steps[i] = input.value;
        });

        const controls = document.createElement("div");
        controls.className = "stepControls";

        const up = document.createElement("button");
        up.className = "iconBtn";
        up.textContent = "↑";
        up.title = "Move up";
        up.disabled = (i === 0);
        up.addEventListener("click", () => {
          const tmp = draft.steps[i - 1];
          draft.steps[i - 1] = draft.steps[i];
          draft.steps[i] = tmp;
          renderDraft();
        });

        const down = document.createElement("button");
        down.className = "iconBtn";
        down.textContent = "↓";
        down.title = "Move down";
        down.disabled = (i === draft.steps.length - 1);
        down.addEventListener("click", () => {
          const tmp = draft.steps[i + 1];
          draft.steps[i + 1] = draft.steps[i];
          draft.steps[i] = tmp;
          renderDraft();
        });

        const del = document.createElement("button");
        del.className = "iconBtn iconBtn--danger";
        del.textContent = "✕";
        del.title = "Delete step";
        del.addEventListener("click", () => {
          draft.steps.splice(i, 1);
          renderDraft();
        });

        controls.appendChild(up);
        controls.appendChild(down);
        controls.appendChild(del);

        row.appendChild(input);
        row.appendChild(controls);
        stepsEl.appendChild(row);
      });

      // delete button enabled only if editing existing recipe
      const editingExisting = selectedIndex >= 0 && selectedIndex < data.recipes.length;
      delBtn.disabled = !editingExisting;
    }

    function renderAll() {
      renderList();
      renderDraft();
    }

    // initial draft
    setDraftFromRecipe(currentRecipe());
    renderAll();

    searchEl.addEventListener("input", () => renderList());

    newBtn.addEventListener("click", () => {
      selectedIndex = -1;
      setDraftFromRecipe(null);
      renderAll();
      toast("New recipe");
    });

    addIngBtn.addEventListener("click", () => {
      draft.ingredients.push("");
      renderDraft();
    });

    addStepBtn.addEventListener("click", () => {
      draft.steps.push("");
      renderDraft();
    });

    saveBtn.addEventListener("click", () => {
      const name = (nameEl.value || "").trim();
      if (!name) {
        toast("Recipe name is required");
        return;
      }

      // Build cleaned recipe
      const cleaned = {
        name,
        ingredients: draft.ingredients.map(x => String(x ?? "").trim()).filter(Boolean),
        steps: draft.steps.map(x => String(x ?? "").trim()).filter(Boolean)
      };

      // If renaming, ensure no collision (except itself)
      const lower = cleaned.name.toLowerCase();
      const collision = data.recipes.find((r, idx) => r.name.toLowerCase() === lower && idx !== selectedIndex);
      if (collision) {
        toast("A recipe with that name already exists");
        return;
      }

      if (selectedIndex >= 0 && selectedIndex < data.recipes.length) {
        const oldName = data.recipes[selectedIndex].name;
        data.recipes[selectedIndex] = cleaned;

        // Update meal plan references if recipe name changed
        if (oldName !== cleaned.name) {
          data.Meals = data.Meals.map(m => (m === oldName ? cleaned.name : m));
        }
      } else {
        data.recipes.push(cleaned);
        data.recipes.sort((a,b) => a.name.localeCompare(b.name));
        selectedIndex = data.recipes.findIndex(r => r.name.toLowerCase() === lower);
      }

      saveData(data);
      setDraftFromRecipe(currentRecipe());
      renderAll();
      toast("Saved");
    });

    delBtn.addEventListener("click", () => {
      const r = currentRecipe();
      if (!r) return;
      const name = r.name;

      // Remove recipe
      data.recipes.splice(selectedIndex, 1);

      // Clear meal plan entries that referenced it
      data.Meals = data.Meals.map(m => (m === name ? "" : m));

      // Reset selection
      selectedIndex = data.recipes.length ? Math.min(selectedIndex, data.recipes.length - 1) : -1;
      saveData(data);
      setDraftFromRecipe(currentRecipe());
      renderAll();
      toast("Deleted");
    });

    // Keep draft name in sync
    nameEl.addEventListener("input", () => {
      draft.name = nameEl.value;
    });
  }

  // ------------------ Grocery page ------------------
  async function pageGroceryInit() {
    const listEl = document.getElementById("groceryList");
    const metaEl = document.getElementById("groceryMeta");
    const rebuildBtn = document.getElementById("rebuildBtn");

    async function build() {
      const data = await loadData();

      // Collect planned recipes (ignore blank days)
      const planned = data.Meals
        .map(name => findRecipe(data, name))
        .filter(Boolean);

      // Count ingredients (case-insensitive), preserve first seen original casing
      const map = new Map(); // key -> {label, count}
      for (const r of planned) {
        for (const ing of r.ingredients) {
          const label = String(ing ?? "").trim();
          if (!label) continue;
          const key = label.toLowerCase();
          const cur = map.get(key);
          if (cur) cur.count += 1;
          else map.set(key, { label, count: 1 });
        }
      }

      const items = Array.from(map.values()).sort((a,b) => a.label.localeCompare(b.label));

      // Render
      listEl.innerHTML = "";
      const dinners = data.Meals.filter(Boolean).length;
      metaEl.textContent = `${items.length} unique items • ${dinners} planned dinners`;

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No groceries yet. Plan some dinners first.";
        listEl.appendChild(empty);
        return;
      }

      for (const it of items) {
        const row = document.createElement("label");
        row.className = "gItem";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = false; // always reset (volatile)

        const text = document.createElement("div");
        text.className = "gText";
        text.textContent = it.label;

        const count = document.createElement("div");
        count.className = "gCount";
        count.textContent = it.count > 1 ? `×${it.count}` : "";

        cb.addEventListener("change", () => {
          // purely visual; not persisted
          row.style.opacity = cb.checked ? "0.55" : "1";
          row.style.textDecoration = cb.checked ? "line-through" : "none";
        });

        row.appendChild(cb);
        row.appendChild(text);
        row.appendChild(count);
        listEl.appendChild(row);
      }
    }

    rebuildBtn?.addEventListener("click", build);
    await build();
  }

  return {
    initPWA,
    pagePlanInit,
    pageRecipesInit,
    pageGroceryInit
  };
})();
