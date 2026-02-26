#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import { FastmailClient } from "./fastmail-client.js";

dotenv.config({ override: false });

const email = process.env.FASTMAIL_EMAIL;
const apiToken = process.env.FASTMAIL_API_TOKEN;

if (!email || !apiToken) {
  console.error("Error: Missing required environment variables");
  console.error(
    "Please set FASTMAIL_EMAIL and FASTMAIL_API_TOKEN in your .env file",
  );
  process.exit(1);
}

const fastmail = new FastmailClient(email, apiToken);

const server = new McpServer({
  name: "local-fastmail-mcp",
  version: "1.0.0",
});

let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = fastmail
      .initialize()
      .then(() => {
        console.error("Fastmail client initialized successfully");
      })
      .catch((error) => {
        console.error("Failed to initialize Fastmail client:", error);
        // Reset so next call retries initialization
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

// 1. List Mailboxes
server.registerTool(
  "list_mailboxes",
  {
    description: "List all email folders/mailboxes in your Fastmail account",
  },
  async () => {
    try {
      await ensureInitialized();
      const mailboxes = await fastmail.getMailboxes();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mailboxes, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 2. List Emails
server.registerTool(
  "list_emails",
  {
    description:
      "List emails in your Fastmail account. Supports pagination — the response includes total, position, and hasMore. To page through results, increment position by limit on each call.",
    inputSchema: z.object({
      mailboxId: z
        .string()
        .optional()
        .describe(
          "Optional. Internal Mailbox ID to filter by. Best discovered via list_mailboxes.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(250)
        .optional()
        .describe(
          "Max number of emails to return per page (default is 20, max 250)",
        ),
      position: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Zero-based offset for pagination. To get the next page, set this to the previous position + limit.",
        ),
      unreadOnly: z
        .boolean()
        .optional()
        .describe("Filter only for unread emails"),
      query: z
        .string()
        .optional()
        .describe("Text string to search for across emails"),
    }),
  },
  async ({ mailboxId, limit, position, unreadOnly, query }) => {
    try {
      await ensureInitialized();
      const result = await fastmail.listEmails({
        mailboxId,
        limit,
        position,
        unreadOnly,
        query,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 3. Read Email
server.registerTool(
  "read_email",
  {
    description:
      "Read a specific email completely by its ID. Use textOnly for HTML-heavy emails like newsletters to dramatically reduce response size.",
    inputSchema: z.object({
      emailId: z.string().describe("The exact ID of the email to read."),
      textOnly: z
        .boolean()
        .optional()
        .describe(
          "When true, only fetch text/plain body parts, skipping HTML content. Ideal for newsletters and HTML-heavy emails to reduce response size.",
        ),
    }),
  },
  async ({ emailId, textOnly }) => {
    try {
      await ensureInitialized();
      const emailContent = await fastmail.readEmail(emailId, { textOnly });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(emailContent, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 4. Send Email
server.registerTool(
  "send_email",
  {
    description: "Send an email from your Fastmail account to another address.",
    inputSchema: z.object({
      to: z.string().email().describe("Destination email address"),
      subject: z.string().min(1).describe("Subject line of the email"),
      body: z.string().min(1).describe("The plaintext body of the email"),
    }),
  },
  async ({ to, subject, body }) => {
    try {
      await ensureInitialized();
      const result = await fastmail.sendEmail({ to, subject, body });
      return {
        content: [
          {
            type: "text",
            text: `Email successfully sent!\nDraft ID: ${result.draftId}\nSubmission ID: ${result.submissionId}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 5. Mark Email Read
server.registerTool(
  "mark_email_read",
  {
    description: "Mark a specific email as read or unread.",
    inputSchema: z.object({
      emailId: z.string().describe("The exact ID of the email to modify."),
      read: z
        .boolean()
        .default(true)
        .describe("True to mark as read, false to mark as unread."),
    }),
  },
  async ({ emailId, read }) => {
    try {
      await ensureInitialized();
      await fastmail.markEmailRead(emailId, read);
      return {
        content: [
          {
            type: "text",
            text: `Email ${emailId} successfully marked as ${read ? "read" : "unread"}.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 6. Move Email
server.registerTool(
  "move_email",
  {
    description: "Move an email to a different mailbox/folder.",
    inputSchema: z.object({
      emailId: z.string().describe("The exact ID of the email to move."),
      mailboxId: z
        .string()
        .describe(
          "The Exact ID of the destination mailbox. Best discovered via list_mailboxes",
        ),
    }),
  },
  async ({ emailId, mailboxId }) => {
    try {
      await ensureInitialized();
      await fastmail.moveEmail(emailId, mailboxId);
      return {
        content: [
          {
            type: "text",
            text: `Email ${emailId} successfully moved to mailbox ${mailboxId}.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// 7. Delete Email
server.registerTool(
  "delete_email",
  {
    description: "Move an email to the Trash mailbox.",
    inputSchema: z.object({
      emailId: z.string().describe("The exact ID of the email to delete."),
    }),
  },
  async ({ emailId }) => {
    try {
      await ensureInitialized();
      await fastmail.deleteEmail(emailId);
      return {
        content: [
          {
            type: "text",
            text: `Email ${emailId} successfully deleted (moved to Trash).`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  console.error("Starting Fastmail MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fastmail MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal API Server error:", error);
  process.exit(1);
});
