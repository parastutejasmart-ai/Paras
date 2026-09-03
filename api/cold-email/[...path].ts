import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  company: z.string().trim().min(1).max(160),
  website: z.string().trim().url().optional().or(z.literal("")),
  linkedinUrl: z.string().trim().url().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional(),
});

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
});

const generateSchema = z.object({
  lead: leadSchema,
  senderName: z.string().trim().min(1).max(120),
  senderCompany: z.string().trim().min(1).max(160),
  offer: z.string().trim().min(10).max(1000),
  callToAction: z.string().trim().min(5).max(300),
});

const sendSchema = z.object({
  approved: z.literal(true),
  lead: leadSchema,
  draft: draftSchema,
});

function isAuthorized(request: VercelRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  const submitted = request.headers["x-dashboard-password"];
  const password = Array.isArray(submitted) ? submitted[0] : submitted;
  if (!expected || !password) return false;

  const expectedBuffer = Buffer.from(expected);
  const passwordBuffer = Buffer.from(password);
  return (
    expectedBuffer.length === passwordBuffer.length &&
    timingSafeEqual(expectedBuffer, passwordBuffer)
  );
}

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function toHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replace(/\n/g, "<br />");
}

async function history(_request: VercelRequest, response: VercelResponse) {
  const { data, error } = await supabase()
    .from("email_sends")
    .select(
      "id,recipient_email,recipient_name,company,subject,email_body,provider_message_id,sent_at",
    )
    .order("sent_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return response.status(200).json(
    (data ?? []).map((item) => ({
      id: item.id,
      recipientEmail: item.recipient_email,
      recipientName: item.recipient_name,
      company: item.company,
      subject: item.subject,
      emailBody: item.email_body,
      providerMessageId: item.provider_message_id,
      sentAt: item.sent_at,
    })),
  );
}

async function generate(request: VercelRequest, response: VercelResponse) {
  if (!process.env.OPENAI_API_KEY) {
    return response
      .status(500)
      .json({ error: "OPENAI_API_KEY is not configured." });
  }
  const payload = generateSchema.parse(request.body);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    store: false,
    instructions:
      "You write respectful B2B cold emails. Return valid JSON only with exactly two keys: subject and body.\n" +
      "Rules: plain-text body only; 70-120 words; use the prospect's first name once; use facts only from the supplied input; " +
      "never claim you visited a linked website or LinkedIn profile; no invented facts, fake familiarity, urgency, hype, emojis, or spam language; " +
      "end with the supplied low-friction call to action.",
    input: JSON.stringify({
      lead: payload.lead,
      sender: {
        name: payload.senderName,
        company: payload.senderCompany,
        offer: payload.offer,
        callToAction: payload.callToAction,
      },
    }),
    text: {
      format: {
        type: "json_schema",
        name: "cold_email",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["subject", "body"],
        },
      },
    },
  });

  return response
    .status(200)
    .json({ lead: payload.lead, draft: draftSchema.parse(JSON.parse(completion.output_text)) });
}

async function send(request: VercelRequest, response: VercelResponse) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return response.status(500).json({ error: "Gmail SMTP is not configured." });
  }
  const payload = sendSchema.parse(request.body);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS.replace(/\s/g, ""),
    },
  });

  const sent = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: payload.lead.email,
    replyTo: process.env.REPLY_TO_EMAIL || process.env.EMAIL_USER,
    subject: payload.draft.subject,
    text: payload.draft.body,
    html: `<div>${toHtml(payload.draft.body)}</div>`,
  });

  const { error } = await supabase().from("email_sends").insert({
    recipient_email: payload.lead.email,
    recipient_name: payload.lead.name,
    company: payload.lead.company,
    subject: payload.draft.subject,
    email_body: payload.draft.body,
    provider_message_id: sent.messageId,
  });

  const result = {
    success: true,
    emailId: sent.messageId,
    sentTo: payload.lead.email,
    warning: error ? "Email sent, but tracking log failed." : null,
  };
  return response.status(error ? 202 : 200).json(result);
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  const action = request.url?.split("?")[0].split("/").filter(Boolean).pop();
  try {
    if (request.method === "GET" && action === "history") {
      return await history(request, response);
    }
    if (request.method === "POST" && action === "generate") {
      return await generate(request, response);
    }
    if (request.method === "POST" && action === "send") {
      return await send(request, response);
    }
    return response.status(404).json({ error: "Not found." });
  } catch (error) {
    console.error("Cold email API error", error);
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: "Invalid request." });
    }
    return response.status(500).json({ error: "Unable to complete the request." });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};