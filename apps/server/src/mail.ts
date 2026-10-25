import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { writable } from "./store.js";

export type MailSender = (
  message: Mail.Options,
) => Promise<{ messageId: string }>;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export function memberMessage(row: any): Mail.Options {
  const p = row.payload,
    url = `${config.origin}/projects/${row.project_id}`;
  const role =
    p.role === "editor" ? "편집자" : p.role === "owner" ? "소유자" : "열람자";
  const greeting = p.name ? `${p.name} 님,` : "안녕하세요.";
  const text = `${greeting}\n\n${p.inviter} 님이 ${p.project} 프로젝트에 ${role}로 추가했습니다.\n\n별도 수락 절차 없이 ${row.email} Google 계정으로 로그인하면 사용할 수 있습니다.\n\n프로젝트 열기: ${url}\n웹 문서: ${config.origin}/docs/p/${row.project_id}/\n`;
  return {
    from: config.smtp.from,
    to: { name: p.name || "", address: row.email },
    subject: `${p.project} 프로젝트에 추가되었습니다`,
    messageId: `<${row.id}@${new URL(config.origin).hostname}>`,
    text,
    html: `<p>${escape(greeting)}</p><p>${escape(p.inviter)} 님이 <strong>${escape(p.project)}</strong> 프로젝트에 ${role}로 추가했습니다.</p><p>별도 수락 절차 없이 <strong>${escape(row.email)}</strong> Google 계정으로 로그인하면 사용할 수 있습니다.</p><p><a href="${escape(url)}">프로젝트 열기</a> · <a href="${escape(config.origin)}/docs/p/${row.project_id}/">웹 문서 열기</a></p>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** The durable outbox records failures separately from project access. */
export function memberMailer(provided?: MailSender) {
  const smtp =
    !provided && config.smtp.host && config.smtp.from
      ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          requireTLS: !config.smtp.secure,
          ...(config.smtp.user
            ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
            : {}),
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      : undefined;
  const sender: MailSender | undefined =
    provided ||
    (smtp
      ? async (message) => {
          const info = await smtp.sendMail(message);
          if (!info.accepted?.length || info.rejected?.length)
            throw Object.assign(new Error("MAIL_REJECTED"), {
              code: "MAIL_REJECTED",
            });
          return { messageId: info.messageId };
        }
      : undefined);
  const active = new Map<string, Promise<any>>();
  let flushing: Promise<void> | undefined;
  async function deliver(id: string, retry = false) {
    const row = await transaction(async (db) => {
      await writable(db);
      const r = await db.query(
        `UPDATE member_mail SET status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes',error=NULL
         WHERE id=$1 AND (status='pending' OR (status='sending' AND lease_until<now()) OR ($2 AND status='failed')) RETURNING *`,
        [id, retry],
      );
      return r.rows[0];
    });
    if (!row)
      return (
        await pool.query(
          "SELECT id,status,error FROM member_mail WHERE id=$1",
          [id],
        )
      ).rows[0];
    try {
      const access = await pool.query(
        `SELECT m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND lower(u.email)=lower($2)
         UNION ALL SELECT role FROM invites WHERE project_id=$1 AND lower(email)=lower($2) AND expires>now() LIMIT 1`,
        [row.project_id, row.email],
      );
      if (!access.rowCount) {
        await pool.query(
          "UPDATE member_mail SET status='cancelled',lease_until=NULL WHERE id=$1",
          [id],
        );
      } else {
        if (!sender)
          throw Object.assign(new Error("MAIL_UNCONFIGURED"), {
            code: "MAIL_UNCONFIGURED",
          });
        row.payload.role = access.rows[0].role;
        const info = await sender(memberMessage(row));
        await pool.query(
          "UPDATE member_mail SET status='sent',sent=now(),message_id=$2,lease_until=NULL WHERE id=$1",
          [id, info.messageId],
        );
      }
    } catch (error: any) {
      // Store a diagnostic code, never SMTP credentials or the raw server response.
      const code =
        typeof error.code === "string" && /^[A-Z_]+$/.test(error.code)
          ? error.code.slice(0, 60)
          : "MAIL_DELIVERY_FAILED";
      await pool.query(
        "UPDATE member_mail SET status='failed',error=$2,lease_until=NULL WHERE id=$1",
        [id, code],
      );
    }
    return (
      await pool.query("SELECT id,status,error FROM member_mail WHERE id=$1", [
        id,
      ])
    ).rows[0];
  }
  function send(id: string, retry = false) {
    if (active.has(id)) return active.get(id)!;
    const result = deliver(id, retry).finally(() => active.delete(id));
    active.set(id, result);
    return result;
  }
  async function drain() {
    if (!sender) return;
    const pending = await pool.query(
      "SELECT id FROM member_mail WHERE status='pending' OR (status='sending' AND lease_until<now()) ORDER BY created LIMIT 20",
    );
    for (const row of pending.rows) await send(row.id);
  }
  function flush() {
    return (flushing ??= drain().finally(() => {
      flushing = undefined;
    }));
  }
  return {
    send,
    flush,
    async close() {
      await flushing?.catch(() => {});
      await Promise.allSettled(active.values());
      smtp?.close();
    },
  };
}
export type MemberMailer = ReturnType<typeof memberMailer>;
