# Databricks AppKit — Momentum UI

Three core interfaces (build spec §6):

1. **Momentum Board** — time-series charts (PyPI/HF downloads, arXiv research volume, GitHub star velocity) across the 5 pillars.
2. **Graph Explorer** — interactive 3D force-directed graph of Trademarks ↔ Repos ↔ Packages ↔ Papers.
3. **Ask + Lineage (Genie)** — natural-language Q&A via Databricks Genie, with verified lineage cards.

## Structure

```
ui/
  package.json
  index.html
  src/
    main.jsx        # entry (planned)
    App.jsx         # root split into 3 views (planned)
```

> Placeholder scaffold. Run `npm install && npm run dev` after real components land.
