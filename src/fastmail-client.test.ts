import { describe, it, expect, vi, beforeEach } from "vitest";
import { FastmailClient } from "./fastmail-client.js";

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const MOCK_SESSION = {
  accounts: {
    "account-id-1": {
      name: "Test Account",
      isPersonal: true,
      isReadOnly: false,
      accountCapabilities: {},
    },
  },
  primaryAccounts: {
    "urn:ietf:params:jmap:mail": "account-id-1",
  },
  username: "test@fastmail.com",
  apiUrl: "https://api.fastmail.com/jmap/api",
  downloadUrl: "https://api.fastmail.com/jmap/download",
  uploadUrl: "https://api.fastmail.com/jmap/upload",
  eventSourceUrl: "https://api.fastmail.com/jmap/event",
  state: "state-1",
};

function mockSessionResponse() {
  return {
    ok: true,
    json: async () => MOCK_SESSION,
  } as any;
}

/** Mocks session fetch and calls client.initialize() */
async function initializeClient(client: FastmailClient) {
  mockFetch.mockResolvedValueOnce(mockSessionResponse());
  await client.initialize();
}

/** Wraps JMAP method responses in the standard response envelope */
function jmapResponse(...methodResponses: any[]) {
  return {
    ok: true,
    json: async () => ({ methodResponses }),
  } as any;
}

/** Creates a minimal mock email object for Email/get responses */
function makeEmail(id: string, overrides?: Record<string, any>) {
  return {
    id,
    blobId: `blob-${id}`,
    threadId: `thread-${id}`,
    mailboxIds: { "mailbox-1": true },
    keywords: {},
    size: 500,
    receivedAt: "2026-02-25T12:00:00Z",
    subject: `Email ${id}`,
    from: [{ name: "Sender", email: "sender@example.com" }],
    to: [{ name: "Test", email: "test@fastmail.com" }],
    hasAttachment: false,
    preview: `Preview of ${id}`,
    ...overrides,
  };
}

/** Creates a standard mailbox list response with inbox, drafts, sent, and trash */
function mockMailboxListResponse() {
  return jmapResponse([
    "Mailbox/get",
    {
      accountId: "account-id-1",
      state: "state-2",
      list: [
        {
          id: "mailbox-inbox",
          name: "Inbox",
          role: "inbox",
          totalEmails: 10,
          unreadEmails: 3,
          totalThreads: 8,
          unreadThreads: 2,
          isSubscribed: true,
          myRights: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: false,
            mayDelete: false,
            maySubmit: true,
          },
        },
        {
          id: "mailbox-drafts",
          name: "Drafts",
          role: "drafts",
          totalEmails: 0,
          unreadEmails: 0,
          totalThreads: 0,
          unreadThreads: 0,
          isSubscribed: true,
          myRights: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: false,
            mayDelete: false,
            maySubmit: true,
          },
        },
        {
          id: "mailbox-trash",
          name: "Trash",
          role: "trash",
          totalEmails: 2,
          unreadEmails: 0,
          totalThreads: 2,
          unreadThreads: 0,
          isSubscribed: true,
          myRights: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: false,
            mayDelete: false,
            maySubmit: true,
          },
        },
      ],
    },
    "0",
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FastmailClient", () => {
  let client: FastmailClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new FastmailClient("test@fastmail.com", "fake-token");
  });

  // ── Initialization ──────────────────────────────────────────────────────

  describe("initialize", () => {
    it("should initialize cleanly given valid credentials", async () => {
      mockFetch.mockResolvedValueOnce(mockSessionResponse());
      await client.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.fastmail.com/jmap/session",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer fake-token",
          }),
        }),
      );
    });

    it("should throw error if initialization fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
      } as any);

      await expect(client.initialize()).rejects.toThrow(
        "Failed to initialize Fastmail session: Unauthorized",
      );
    });

    it("throws error when making requests before initialization", async () => {
      await expect(client.getMailboxes()).rejects.toThrow(
        /Fastmail client is not initialized/,
      );
    });
  });

  // ── makeRequest error handling ──────────────────────────────────────────

  describe("makeRequest error handling", () => {
    it("should throw truncated error on HTTP failure", async () => {
      await initializeClient(client);

      const longErrorBody = "x".repeat(300);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => longErrorBody,
      } as any);

      await expect(client.getMailboxes()).rejects.toThrow(
        /JMAP HTTP Error 500/,
      );

      // Verify the thrown message is truncated (not the full 300 chars)
      try {
        await client.getMailboxes();
      } catch {
        // already thrown above
      }
    });

    it("should throw safe error on invalid response structure", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ garbage: true }),
      } as any);

      await expect(client.getMailboxes()).rejects.toThrow(
        "Invalid JMAP response: server did not return methodResponses.",
      );
    });

    it("should throw structured error on JMAP method error", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "error",
          {
            type: "unknownMethod",
            description: "The method 'Mailbox/get' is not recognized.",
          },
          "0",
        ]),
      );

      await expect(client.getMailboxes()).rejects.toThrow(
        "JMAP API Error (unknownMethod): The method 'Mailbox/get' is not recognized.",
      );
    });

    it("should handle JMAP method error with missing fields", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(jmapResponse(["error", {}, "0"]));

      await expect(client.getMailboxes()).rejects.toThrow(
        "JMAP API Error (unknown): No description provided.",
      );
    });
  });

  // ── getMailboxes ────────────────────────────────────────────────────────

  describe("getMailboxes", () => {
    it("should return parsed mailbox list", async () => {
      await initializeClient(client);
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());

      const mailboxes = await client.getMailboxes();

      expect(mailboxes).toHaveLength(3);
      expect(mailboxes[0].name).toBe("Inbox");
      expect(mailboxes[1].role).toBe("drafts");
      expect(mailboxes[2].role).toBe("trash");

      // Ensure the post requested the correct apiUrl
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.fastmail.com/jmap/api",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  // ── readEmail ───────────────────────────────────────────────────────────

  describe("readEmail", () => {
    function mockReadEmailResponse(opts?: { includeHtml?: boolean }) {
      const bodyValues: Record<string, any> = {
        "part-text": { value: "Hello, plain text body" },
      };
      if (opts?.includeHtml) {
        bodyValues["part-html"] = {
          value: "<html><body><h1>Hello</h1></body></html>",
        };
      }

      return jmapResponse([
        "Email/get",
        {
          accountId: "account-id-1",
          state: "state-3",
          list: [
            makeEmail("email-1", {
              subject: "Test Email",
              bodyValues,
              textBody: [{ partId: "part-text", type: "text/plain" }],
              htmlBody: opts?.includeHtml
                ? [{ partId: "part-html", type: "text/html" }]
                : [],
            }),
          ],
          notFound: [],
        },
        "0",
      ]);
    }

    it("should only fetch text body values when textOnly is true", async () => {
      await initializeClient(client);
      mockFetch.mockResolvedValueOnce(mockReadEmailResponse());

      const result = await client.readEmail("email-1", { textOnly: true });

      expect(result.textBody).toBe("Hello, plain text body");
      expect(result).not.toHaveProperty("htmlBody");

      // Verify redundant fields are stripped from the email object
      expect(result.email).not.toHaveProperty("bodyValues");
      expect(result.email).not.toHaveProperty("textBody");
      expect(result.email).not.toHaveProperty("htmlBody");

      // Verify the JMAP request only included fetchTextBodyValues
      const lastCallBody = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body,
      );
      const emailGetArgs = lastCallBody.methodCalls[0][1];
      expect(emailGetArgs.fetchTextBodyValues).toBe(true);
      expect(emailGetArgs).not.toHaveProperty("fetchHTMLBodyValues");
    });

    it("should fetch both text and HTML body values by default", async () => {
      await initializeClient(client);
      mockFetch.mockResolvedValueOnce(
        mockReadEmailResponse({ includeHtml: true }),
      );

      const result = await client.readEmail("email-1");

      expect(result.textBody).toBe("Hello, plain text body");
      expect(result.htmlBody).toBe("<html><body><h1>Hello</h1></body></html>");

      // Verify redundant fields are stripped from the email object
      expect(result.email).not.toHaveProperty("bodyValues");
      expect(result.email).not.toHaveProperty("textBody");
      // htmlBody structural metadata IS kept in default mode
      expect(result.email).toHaveProperty("htmlBody");

      const lastCallBody = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body,
      );
      const emailGetArgs = lastCallBody.methodCalls[0][1];
      expect(emailGetArgs.fetchTextBodyValues).toBe(true);
      expect(emailGetArgs.fetchHTMLBodyValues).toBe(true);
    });

    it("should throw when email is not found", async () => {
      await initializeClient(client);
      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/get",
          {
            accountId: "account-id-1",
            state: "state-3",
            list: [],
            notFound: ["nonexistent-id"],
          },
          "0",
        ]),
      );

      await expect(client.readEmail("nonexistent-id")).rejects.toThrow(
        "Email with ID nonexistent-id not found.",
      );
    });
  });

  // ── listEmails pagination ──────────────────────────────────────────────

  describe("listEmails pagination", () => {
    function mockQueryAndGet(opts: {
      ids: string[];
      total: number;
      position: number;
    }) {
      // listEmails now sends Email/query + Email/get in a single JMAP request,
      // so we mock both responses in one fetch response.
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          [
            "Email/query",
            {
              accountId: "account-id-1",
              queryState: "qs-1",
              position: opts.position,
              total: opts.total,
              ids: opts.ids,
            },
            "emailQuery",
          ],
          [
            "Email/get",
            {
              accountId: "account-id-1",
              state: "state-2",
              list: opts.ids.map((id) => makeEmail(id)),
              notFound: [],
            },
            "emailGet",
          ],
        ),
      );
    }

    it("should return pagination metadata with default position 0", async () => {
      await initializeClient(client);
      mockQueryAndGet({ ids: ["e1", "e2"], total: 50, position: 0 });

      const result = await client.listEmails();

      expect(result.emails).toHaveLength(2);
      expect(result.total).toBe(50);
      expect(result.position).toBe(0);
      expect(result.hasMore).toBe(true);
    });

    it("should pass position through to the JMAP query", async () => {
      await initializeClient(client);
      mockQueryAndGet({ ids: ["e21", "e22"], total: 50, position: 20 });

      const result = await client.listEmails({ position: 20, limit: 20 });

      expect(result.position).toBe(20);
      expect(result.hasMore).toBe(true);

      const queryCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const queryArgs = queryCallBody.methodCalls[0][1];
      expect(queryArgs.position).toBe(20);
      expect(queryArgs.limit).toBe(20);
      expect(queryArgs.calculateTotal).toBe(true);

      // Verify Email/get uses back-reference to Email/query
      const getArgs = queryCallBody.methodCalls[1][1];
      expect(getArgs["#ids"]).toEqual({
        resultOf: "emailQuery",
        name: "Email/query",
        path: "/ids",
      });
    });

    it("should set hasMore to false on the last page", async () => {
      await initializeClient(client);
      mockQueryAndGet({ ids: ["e41", "e42"], total: 42, position: 40 });

      const result = await client.listEmails({ position: 40, limit: 20 });

      expect(result.emails).toHaveLength(2);
      expect(result.total).toBe(42);
      expect(result.position).toBe(40);
      expect(result.hasMore).toBe(false);
    });

    it("should handle empty results", async () => {
      await initializeClient(client);
      mockQueryAndGet({ ids: [], total: 0, position: 0 });

      const result = await client.listEmails({ query: "nonexistent" });

      expect(result.emails).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should assume hasMore when total is null and got a full page", async () => {
      await initializeClient(client);

      // Simulate a server that doesn't return total — single combined response
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          [
            "Email/query",
            {
              accountId: "account-id-1",
              queryState: "qs-1",
              position: 0,
              ids: ["e1", "e2", "e3"],
            },
            "emailQuery",
          ],
          [
            "Email/get",
            {
              accountId: "account-id-1",
              state: "state-2",
              list: ["e1", "e2", "e3"].map((id) => makeEmail(id)),
              notFound: [],
            },
            "emailGet",
          ],
        ),
      );

      const result = await client.listEmails({ limit: 3 });

      expect(result.emails).toHaveLength(3);
      expect(result.total).toBeNull();
      expect(result.hasMore).toBe(true);
    });
  });

  // ── sendEmail ──────────────────────────────────────────────────────────

  describe("sendEmail", () => {
    function mockIdentityResponse() {
      return jmapResponse([
        "Identity/get",
        {
          accountId: "account-id-1",
          state: "state-id",
          list: [
            {
              id: "identity-1",
              email: "test@fastmail.com",
            },
          ],
        },
        "0",
      ]);
    }

    function mockSendSuccessResponse() {
      return jmapResponse(
        [
          "Email/set",
          {
            accountId: "account-id-1",
            created: {
              draft: { id: "draft-id-123" },
            },
          },
          "0",
        ],
        [
          "EmailSubmission/set",
          {
            accountId: "account-id-1",
            created: {
              sendIt: { id: "submission-id-456" },
            },
          },
          "1",
        ],
      );
    }

    it("should send email successfully", async () => {
      await initializeClient(client);

      // getIdentityId → Identity/get
      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      // getMailboxes → Mailbox/get (to find drafts folder)
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      // Email/set + EmailSubmission/set
      mockFetch.mockResolvedValueOnce(mockSendSuccessResponse());

      const result = await client.sendEmail({
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "Hello, world!",
      });

      expect(result.draftId).toBe("draft-id-123");
      expect(result.submissionId).toBe("submission-id-456");
    });

    it("should throw if no drafts mailbox is found", async () => {
      await initializeClient(client);

      // getIdentityId
      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      // getMailboxes — return only inbox (no drafts)
      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Mailbox/get",
          {
            accountId: "account-id-1",
            state: "state-2",
            list: [
              {
                id: "mailbox-inbox",
                name: "Inbox",
                role: "inbox",
                totalEmails: 0,
                unreadEmails: 0,
                totalThreads: 0,
                unreadThreads: 0,
                isSubscribed: true,
                myRights: {
                  mayReadItems: true,
                  mayAddItems: true,
                  mayRemoveItems: true,
                  maySetSeen: true,
                  maySetKeywords: true,
                  mayCreateChild: true,
                  mayRename: false,
                  mayDelete: false,
                  maySubmit: true,
                },
              },
            ],
          },
          "0",
        ]),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/Could not find a Drafts mailbox/);
    });

    it("should throw if no identity is found", async () => {
      await initializeClient(client);

      // getIdentityId — return empty list
      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Identity/get",
          {
            accountId: "account-id-1",
            state: "state-id",
            list: [],
          },
          "0",
        ]),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/No submitting identity found/);
    });

    it("should throw on Email/set notCreated error", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          [
            "Email/set",
            {
              accountId: "account-id-1",
              notCreated: {
                draft: { type: "invalidProperties", description: "Bad email" },
              },
            },
            "0",
          ],
          ["EmailSubmission/set", { accountId: "account-id-1" }, "1"],
        ),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/Failed to create draft/);
    });

    it("should throw on EmailSubmission/set notCreated error", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          [
            "Email/set",
            {
              accountId: "account-id-1",
              created: { draft: { id: "draft-id-123" } },
            },
            "0",
          ],
          [
            "EmailSubmission/set",
            {
              accountId: "account-id-1",
              notCreated: {
                sendIt: {
                  type: "forbidden",
                  description: "Sending not allowed",
                },
              },
            },
            "1",
          ],
        ),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/Failed to submit email/);
    });

    it("should throw if draft ID is missing from response", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      // Response has created but no draft inside
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          ["Email/set", { accountId: "account-id-1", created: {} }, "0"],
          [
            "EmailSubmission/set",
            {
              accountId: "account-id-1",
              created: { sendIt: { id: "sub-1" } },
            },
            "1",
          ],
        ),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/no draft ID was returned/);
    });

    it("should throw if submission ID is missing from response", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(mockIdentityResponse());
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      mockFetch.mockResolvedValueOnce(
        jmapResponse(
          [
            "Email/set",
            {
              accountId: "account-id-1",
              created: { draft: { id: "draft-1" } },
            },
            "0",
          ],
          [
            "EmailSubmission/set",
            { accountId: "account-id-1", created: {} },
            "1",
          ],
        ),
      );

      await expect(
        client.sendEmail({
          to: "recipient@example.com",
          subject: "Test",
          body: "Test",
        }),
      ).rejects.toThrow(/submission failed: no submission ID/);
    });
  });

  // ── markEmailRead ──────────────────────────────────────────────────────

  describe("markEmailRead", () => {
    it("should mark email as read successfully", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          { accountId: "account-id-1", updated: { "email-1": null } },
          "0",
        ]),
      );

      // Should not throw
      await client.markEmailRead("email-1", true);

      // Verify the JMAP payload
      const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const updateArgs = callBody.methodCalls[0][1];
      expect(updateArgs.update["email-1"]["keywords/$seen"]).toBe(true);
    });

    it("should mark email as unread", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          { accountId: "account-id-1", updated: { "email-1": null } },
          "0",
        ]),
      );

      await client.markEmailRead("email-1", false);

      const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const updateArgs = callBody.methodCalls[0][1];
      expect(updateArgs.update["email-1"]["keywords/$seen"]).toBe(false);
    });

    it("should throw on notUpdated error", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          {
            accountId: "account-id-1",
            notUpdated: {
              "email-1": { type: "notFound", description: "Email not found" },
            },
          },
          "0",
        ]),
      );

      await expect(client.markEmailRead("email-1")).rejects.toThrow(
        /Failed to mark email read/,
      );
    });
  });

  // ── moveEmail ──────────────────────────────────────────────────────────

  describe("moveEmail", () => {
    it("should move email successfully", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          { accountId: "account-id-1", updated: { "email-1": null } },
          "0",
        ]),
      );

      await client.moveEmail("email-1", "mailbox-archive");

      const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const updateArgs = callBody.methodCalls[0][1];
      expect(updateArgs.update["email-1"].mailboxIds).toEqual({
        "mailbox-archive": true,
      });
    });

    it("should throw on notUpdated error", async () => {
      await initializeClient(client);

      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          {
            accountId: "account-id-1",
            notUpdated: {
              "email-1": {
                type: "invalidProperties",
                description: "Mailbox not found",
              },
            },
          },
          "0",
        ]),
      );

      await expect(
        client.moveEmail("email-1", "nonexistent-mailbox"),
      ).rejects.toThrow(/Failed to move email/);
    });
  });

  // ── deleteEmail ────────────────────────────────────────────────────────

  describe("deleteEmail", () => {
    it("should delete email by moving to trash", async () => {
      await initializeClient(client);

      // getMailboxes to find trash
      mockFetch.mockResolvedValueOnce(mockMailboxListResponse());
      // moveEmail (Email/set)
      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Email/set",
          { accountId: "account-id-1", updated: { "email-1": null } },
          "0",
        ]),
      );

      await client.deleteEmail("email-1");

      // Verify the move targeted the trash mailbox
      const moveCallBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      const moveArgs = moveCallBody.methodCalls[0][1];
      expect(moveArgs.update["email-1"].mailboxIds).toEqual({
        "mailbox-trash": true,
      });
    });

    it("should throw if no trash mailbox is found", async () => {
      await initializeClient(client);

      // getMailboxes — only inbox, no trash
      mockFetch.mockResolvedValueOnce(
        jmapResponse([
          "Mailbox/get",
          {
            accountId: "account-id-1",
            state: "state-2",
            list: [
              {
                id: "mailbox-inbox",
                name: "Inbox",
                role: "inbox",
                totalEmails: 0,
                unreadEmails: 0,
                totalThreads: 0,
                unreadThreads: 0,
                isSubscribed: true,
                myRights: {
                  mayReadItems: true,
                  mayAddItems: true,
                  mayRemoveItems: true,
                  maySetSeen: true,
                  maySetKeywords: true,
                  mayCreateChild: true,
                  mayRename: false,
                  mayDelete: false,
                  maySubmit: true,
                },
              },
            ],
          },
          "0",
        ]),
      );

      await expect(client.deleteEmail("email-1")).rejects.toThrow(
        /Could not find a Trash mailbox/,
      );
    });
  });
});
