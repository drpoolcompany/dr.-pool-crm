# Dr. Pool staff app

Static site (GitHub Pages) for Dr. Pool staff. Sign in with your username and password.

- `index.html`: sign-in and app launcher
- `crm/`: team CRM (your tasks, the Office view, customers, jobs)
- `board/`: shared inbox Chalkboard (Office access)
- `shared/drpool.js`: Supabase connection and sign-in

Data lives in Supabase and is protected by row-level security. The key in `shared/drpool.js` is the public
"publishable" key, so it is safe to have in a public repo.
