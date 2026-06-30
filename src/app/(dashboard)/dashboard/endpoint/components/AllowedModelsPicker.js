"use client";

import { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";

export default function AllowedModelsPicker({ selected = [], onChange }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/v1/models", { cache: "no-store" });
        const data = await res.json();
        if (alive && res.ok) setModels(Array.isArray(data?.data) ? data.data : []);
      } catch {
        if (alive) setModels([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((m) => m !== id));
    else onChange([...selected, id]);
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byOwner = {};
    for (const m of models) {
      if (!m?.id) continue;
      if (q && !m.id.toLowerCase().includes(q)) continue;
      const owner = m.owned_by || "other";
      (byOwner[owner] ||= []).push(m.id);
    }
    const owners = Object.keys(byOwner).sort((a, b) => {
      if (a === "combo") return -1;
      if (b === "combo") return 1;
      return a.localeCompare(b);
    });
    return owners.map((owner) => ({
      owner,
      label: owner === "combo" ? "Combos" : owner,
      ids: byOwner[owner].sort((a, b) => a.localeCompare(b)),
    }));
  }, [models, query]);

  return (
    <div className="flex flex-col gap-2">
      {/* Search */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
          search
        </span>
        <input
          type="text"
          placeholder="Search models..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Selected count */}
      {selected.length > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{selected.length} selected</span>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* List */}
      <div className="max-h-[300px] overflow-y-auto space-y-3 border border-border rounded-lg p-2 bg-surface">
        {loading ? (
          <p className="text-xs text-text-muted px-1 py-2">Loading models…</p>
        ) : groups.length === 0 ? (
          <p className="text-xs text-text-muted px-1 py-2">
            {query ? "No models match your search." : "No models available. Connect a provider first."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.owner}>
              <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
                {g.owner === "combo" && (
                  <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
                )}
                <span className="text-xs font-medium text-primary">{g.label}</span>
                <span className="text-[10px] text-text-muted">({g.ids.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.ids.map((id) => {
                  const isSel = selected.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(id)}
                      className={`px-2 py-1 rounded-xl text-xs font-medium transition-all border flex items-center gap-1 ${isSel
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                        }`}
                    >
                      {isSel && (
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
                      )}
                      {id}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

AllowedModelsPicker.propTypes = {
  selected: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
};
