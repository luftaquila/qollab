import { transaction } from "./db.js";
import { audit, writable } from "./store.js";

/** Email grants attach to the verified account without a separate acceptance step. */
export async function linkEmailMemberships(user: {
  id: string;
  email: string;
}) {
  if (user.id === "anonymous") return;
  await transaction(async (db) => {
    await writable(db);
    // Membership changes lock projects first, including when several grants arrive together.
    const projects = await db.query(
      `SELECT p.id FROM projects p WHERE EXISTS(
        SELECT 1 FROM invites i WHERE i.project_id=p.id AND lower(i.email)=lower($1) AND i.expires>now()
      ) ORDER BY p.id FOR UPDATE OF p`,
      [user.email],
    );
    for (const p of projects.rows) {
      const grants = await db.query(
        "DELETE FROM invites WHERE project_id=$1 AND lower(email)=lower($2) AND expires>now() RETURNING role",
        [p.id, user.email],
      );
      for (const grant of grants.rows) {
        await db.query(
          "INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [p.id, user.id, grant.role],
        );
        await audit(db, p.id, user.id, "member.link", { email: user.email });
      }
    }
  });
}
