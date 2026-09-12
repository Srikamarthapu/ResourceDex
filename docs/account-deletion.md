# Self-service account deletion

Open **Account settings → Delete account**, enter the current password, and type `DELETE`. The confirmation explains that removal is permanent. The browser never sends an account ID; the server uses the user returned by Supabase Auth.

`DELETE /api/account` reauthenticates the password with an isolated client, marks the account for deletion, removes database records and both photo namespaces, revokes sessions, and hard-deletes the Auth user. The marker hides listings and blocks new writes, including uploads that were signed before deletion started. Cleanup releases reservations held on other owners' resources and removes requests and pickup details involving deleted listings.

The database functions are callable only by the server role. Apply `20260912211234_self_service_account_deletion.sql` before deploying the route. Storage objects are removed through the Storage API rather than deleting metadata rows directly.

If cleanup fails, the marker remains and the page offers **Finish deleting account**. Retry with the same account and password; completed cleanup steps are safe to repeat. If the session expired or was revoked, sign in again first. A successful deletion clears the browser session and returns to the sign-in page. Provider backups and operational logs follow their own retention periods.

Automated destructive checks must create fresh disposable accounts and remove only their recorded IDs and storage prefixes. Never run deletion tests against existing demo or user accounts.
