# Cooly Studio (standalone)

Run Studio separately on React 18 to avoid React 19 UI warnings.

## Setup

1. From repo root:
```bash
cd studio
npm install
```

2. Run locally:
```bash
npm run dev
```
This serves Studio (with desk + vision). Use the URL printed in the console.

## Environment

Ensure these env vars are available to Studio (create a `.env` in the `studio/` folder or set in shell):
```
NEXT_PUBLIC_SANITY_PROJECT_ID=zlcfuo6a
NEXT_PUBLIC_SANITY_DATASET=production
```

## Notes
- Studio and the Next app share schemas from `frontend/sanity/schemas`.
- If you see CORS errors, add the Studio dev URL (e.g., http://localhost:3333) in your Sanity project CORS origins.
- Data is shared; publishing content here appears immediately in the Next app.


