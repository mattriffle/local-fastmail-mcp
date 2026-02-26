import {
  JMAPSessionSchema,
  JMAPRequest,
  MethodCall,
  MailboxGetResponseSchema,
  EmailQueryResponseSchema,
  EmailGetResponseSchema,
  IdentityGetResponseSchema,
  Email,
} from "./jmap-types.js";

export class FastmailClient {
  private apiToken: string;
  private sessionUrl = "https://api.fastmail.com/jmap/session";
  private apiUrl: string | null = null;
  private accountId: string | null = null;
  private trashMailboxId: string | null = null;
  public emailAddress: string;

  constructor(emailAddress: string, apiToken: string) {
    this.emailAddress = emailAddress;
    this.apiToken = apiToken;
  }

  /**
   * Initializes the client by discovering the JMAP session URLs and primary account ID
   * derived from the provided API Token. This method must be called before making any
   * requests to the underlying Fastmail client.
   */
  async initialize(): Promise<void> {
    const response = await fetch(this.sessionUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to initialize Fastmail session: ${response.statusText}`,
      );
    }

    const data = await response.json();
    const session = JMAPSessionSchema.parse(data);

    this.apiUrl = session.apiUrl;
    this.accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];

    if (!this.accountId) {
      throw new Error("Primary mail account ID not found in Fastmail session");
    }
  }

  /**
   * Translates arbitrary tuples of JMAP Method Calls into an authenticated HTTP POST payload
   * sent to the user's mapped `apiUrl` endpoint, then unwraps and extracts the Method Responses.
   *
   * @param methodCalls The sequence of JMAP MethodCalls to execute
   * @returns An array of unpacked method responses
   */
  private async makeRequest(methodCalls: MethodCall[]): Promise<any[]> {
    if (!this.apiUrl || !this.accountId) {
      throw new Error(
        "Fastmail client is not initialized. Call initialize() first.",
      );
    }

    const requestBody: JMAPRequest = {
      using: [
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:submission",
      ],
      methodCalls,
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Log full error for debugging, but only surface a truncated summary
      console.error(`JMAP HTTP Error ${response.status}: ${errorText}`);
      const safeText =
        errorText.length > 200 ? errorText.slice(0, 200) + "..." : errorText;
      throw new Error(`JMAP HTTP Error ${response.status}: ${safeText}`);
    }

    const json = (await response.json()) as any;

    // Check if the overall response has methodResponses
    if (!json.methodResponses) {
      console.error(
        "Invalid JMAP response structure:",
        JSON.stringify(json).slice(0, 500),
      );
      throw new Error(
        "Invalid JMAP response: server did not return methodResponses.",
      );
    }

    // Check for JMAP-level method errors
    json.methodResponses.forEach((res: any) => {
      if (res[0] === "error") {
        const errType = res[1]?.type ?? "unknown";
        const errDesc = res[1]?.description ?? "No description provided.";
        console.error(`JMAP method error [${errType}]: ${errDesc}`);
        throw new Error(`JMAP API Error (${errType}): ${errDesc}`);
      }
    });

    return json.methodResponses;
  }

  /**
   * Fetches the complete list of available Folders / Mailboxes within the primary Fastmail account.
   * Useful for discovering system labels (`inbox`, `drafts`, `trash`) IDs or custom folders.
   *
   * @returns An array of mapped `Mailbox` properties and permissions
   */
  async getMailboxes() {
    const responses = await this.makeRequest([
      [
        "Mailbox/get",
        {
          accountId: this.accountId,
          ids: null,
        },
        "0",
      ],
    ]);

    const [, result] = responses[0];
    const parsed = MailboxGetResponseSchema.parse(result);
    return parsed.list;
  }

  /**
   * Queries the JMAP server for a list of emails matching specific filtering criteria.
   * Automatically fetches the header preview snippet, subject, timestamp, and active mailboxes.
   *
   * Supports pagination via `position` — set it to the next index after the last result
   * (e.g., position 0 + limit 20 → next call with position 20) to page through large result sets.
   *
   * @param args.mailboxId The JMAP string ID of the folder to filter inside
   * @param args.limit Maximum number of emails to return (default: 20)
   * @param args.position Zero-based index to start from for pagination (default: 0)
   * @param args.unreadOnly Filters queries exclusively by keywords failing the '$seen' match
   * @param args.query Raw text query executed explicitly against the Fastmail search analyzer
   * @returns An object with `emails`, `total`, `position`, and `hasMore` for pagination
   */
  async listEmails(args?: {
    mailboxId?: string;
    limit?: number;
    position?: number;
    unreadOnly?: boolean;
    query?: string;
  }) {
    const filter: any = {};
    const limit = args?.limit ?? 20;
    const position = args?.position ?? 0;

    if (args?.mailboxId) filter.inMailbox = args.mailboxId;
    if (args?.unreadOnly) filter.notKeyword = "$seen";
    if (args?.query) filter.text = args.query;

    // Send both Email/query and Email/get in a single JMAP request.
    // Email/get uses a back-reference (#ids) to the query result,
    // eliminating a second round-trip and the associated race condition.
    const responses = await this.makeRequest([
      [
        "Email/query",
        {
          accountId: this.accountId,
          filter: Object.keys(filter).length > 0 ? filter : null,
          sort: [{ property: "receivedAt", isAscending: false }],
          position,
          limit,
          calculateTotal: true,
        },
        "emailQuery",
      ],
      [
        "Email/get",
        {
          accountId: this.accountId,
          "#ids": {
            resultOf: "emailQuery",
            name: "Email/query",
            path: "/ids",
          },
          properties: [
            "id",
            "blobId",
            "threadId",
            "size",
            "subject",
            "from",
            "to",
            "receivedAt",
            "preview",
            "hasAttachment",
            "keywords",
            "mailboxIds",
          ],
        },
        "emailGet",
      ],
    ]);

    const queryResponse = responses.find((r: any[]) => r[0] === "Email/query");
    const getResponse = responses.find((r: any[]) => r[0] === "Email/get");

    if (!queryResponse || !getResponse) {
      throw new Error(
        "Unexpected JMAP response: missing Email/query or Email/get results.",
      );
    }

    const [, queryResult] = queryResponse;
    const parsedQuery = EmailQueryResponseSchema.parse(queryResult);
    const total = parsedQuery.total ?? null;

    const [, getResult] = getResponse;
    const parsedGet = EmailGetResponseSchema.parse(getResult);

    const hasMore =
      total !== null
        ? position + parsedGet.list.length < total
        : parsedGet.list.length >= limit;

    return {
      emails: parsedGet.list,
      total,
      position,
      hasMore,
    };
  }

  /**
   * Given a precise Email ID, fetches the underlying structural parts including both
   * `textBody` strings and full `htmlBody` structures and collapses them into a
   * streamlined format suitable for reading via an LLM.
   *
   * When `textOnly` is enabled, only `text/plain` body values are fetched, skipping
   * the potentially large HTML content. This dramatically reduces response size for
   * HTML-heavy emails like newsletters.
   *
   * @param emailId The JMAP system ID for the specific email
   * @param options.textOnly When true, only fetch text/plain body parts (default: false)
   * @returns A structured object containing the raw email shape alongside joined textual components
   */
  async readEmail(emailId: string, options?: { textOnly?: boolean }) {
    const textOnly = options?.textOnly ?? false;

    const fetchParams: Record<string, any> = {
      accountId: this.accountId,
      ids: [emailId],
      fetchTextBodyValues: true,
    };

    if (!textOnly) {
      fetchParams.fetchHTMLBodyValues = true;
    }

    const responses = await this.makeRequest([["Email/get", fetchParams, "0"]]);

    const [, getResult] = responses[0];
    const parsedGet = EmailGetResponseSchema.parse(getResult);

    if (parsedGet.list.length === 0) {
      throw new Error(`Email with ID ${emailId} not found.`);
    }

    const email = parsedGet.list[0];

    // Extract meaningful body content for MCP formatting
    let textBody = "";
    let htmlBody = "";

    if (email.textBody && email.bodyValues) {
      for (const part of email.textBody) {
        if (email.bodyValues[part.partId]) {
          textBody += email.bodyValues[part.partId].value + "\n";
        }
      }
    }

    if (!textOnly && email.htmlBody && email.bodyValues) {
      for (const part of email.htmlBody) {
        if (email.bodyValues[part.partId]) {
          htmlBody += email.bodyValues[part.partId].value + "\n";
        }
      }
    }

    // Strip raw body data from the email object to avoid redundancy —
    // bodyValues, textBody, and htmlBody are already extracted into the
    // top-level fields. In textOnly mode, also drop htmlBody metadata.
    const {
      bodyValues: _bv,
      textBody: _tb,
      htmlBody: _hb,
      ...emailWithoutBodies
    } = email;

    return {
      email: textOnly
        ? emailWithoutBodies
        : { ...emailWithoutBodies, htmlBody: email.htmlBody },
      textBody: textBody.trim(),
      ...(textOnly ? {} : { htmlBody: htmlBody.trim() }),
    };
  }

  /**
   * Queries the server for the user's configured SMTP send-as Identities in order
   * to accurately locate the transmission UUID needed when constructing outgoing emails.
   */
  private async getIdentityId(): Promise<string> {
    const responses = await this.makeRequest([
      [
        "Identity/get",
        {
          accountId: this.accountId,
          ids: null,
        },
        "0",
      ],
    ]);

    const [, result] = responses[0];
    const parsed = IdentityGetResponseSchema.parse(result);

    const primaryOrMatching =
      parsed.list.find((i) => i.email === this.emailAddress) || parsed.list[0];
    if (!primaryOrMatching) {
      throw new Error("No submitting identity found on this Fastmail account.");
    }

    return primaryOrMatching.id;
  }

  /**
   * Assembles a completely new email directly inside the fastmail `drafts` folder and
   * immediately transmits it over the submission network.
   *
   * @param args.to The destination email address
   * @param args.subject Email subject snippet
   * @param args.body Multi-line body context appended directly into text/plain part format
   * @returns The newly minted `draftId` combined with the confirmed transmission `submissionId`
   */
  async sendEmail(args: { to: string; subject: string; body: string }) {
    const identityId = await this.getIdentityId();

    // First, find the drafts mailbox
    const mailboxes = await this.getMailboxes();
    const draftsFolder = mailboxes.find((m) => m.role === "drafts");

    if (!draftsFolder) {
      throw new Error(
        "Could not find a Drafts mailbox. Email cannot be created without a target mailbox.",
      );
    }

    const mailboxIds: Record<string, boolean> = {
      [draftsFolder.id]: true,
    };

    const emailToCreate = {
      from: [{ email: this.emailAddress }],
      to: [{ email: args.to }],
      subject: args.subject,
      keywords: { $draft: true },
      mailboxIds,
      bodyValues: {
        bodyPart: {
          value: args.body,
          charset: "utf-8",
        },
      },
      textBody: [{ partId: "bodyPart", type: "text/plain" }],
    };

    const responses = await this.makeRequest([
      [
        "Email/set",
        {
          accountId: this.accountId,
          create: {
            draft: emailToCreate,
          },
        },
        "0",
      ],
      [
        "EmailSubmission/set",
        {
          accountId: this.accountId,
          onSuccessDestroyEmail: ["#sendIt"],
          create: {
            sendIt: {
              emailId: "#draft",
              identityId: identityId,
              envelope: {
                mailFrom: { email: this.emailAddress },
                rcptTo: [{ email: args.to }],
              },
            },
          },
        },
        "1",
      ],
    ]);

    const [, emailSetResult] =
      responses.find((r: any[]) => r[0] === "Email/set") || [];
    const [, submissionSetResult] =
      responses.find((r: any[]) => r[0] === "EmailSubmission/set") || [];

    if (
      emailSetResult?.notCreated &&
      Object.keys(emailSetResult.notCreated).length > 0
    ) {
      throw new Error(
        `Failed to create draft: ${JSON.stringify(emailSetResult.notCreated)}`,
      );
    }

    if (
      submissionSetResult?.notCreated &&
      Object.keys(submissionSetResult.notCreated).length > 0
    ) {
      throw new Error(
        `Failed to submit email: ${JSON.stringify(submissionSetResult.notCreated)}`,
      );
    }

    const draftId = emailSetResult?.created?.draft?.id;
    const submissionId = submissionSetResult?.created?.sendIt?.id;

    if (!draftId) {
      throw new Error(
        "Email send may have failed: no draft ID was returned by the server.",
      );
    }

    if (!submissionId) {
      throw new Error(
        "Email draft was created but submission failed: no submission ID was returned by the server.",
      );
    }

    return { draftId, submissionId };
  }

  /**
   * Modifies an email's `$seen` JMAP keyword status.
   *
   * @param emailId Target exact email string ID
   * @param read Triggers marking the email as read (true) or unread (false)
   */
  async markEmailRead(emailId: string, read: boolean = true): Promise<void> {
    const responses = await this.makeRequest([
      [
        "Email/set",
        {
          accountId: this.accountId,
          update: {
            [emailId]: {
              "keywords/$seen": read,
            },
          },
        },
        "0",
      ],
    ]);

    const [, result] = responses.find((r: any[]) => r[0] === "Email/set") || [];
    if (result?.notUpdated && Object.keys(result.notUpdated).length > 0) {
      throw new Error(
        `Failed to mark email read: ${JSON.stringify(result.notUpdated)}`,
      );
    }
  }

  /**
   * Rewrites an email's parent folder routing mapping.
   *
   * @param emailId Target exact email string ID to shift
   * @param targetMailboxId The newly calculated target ID to apply
   */
  async moveEmail(emailId: string, targetMailboxId: string): Promise<void> {
    const responses = await this.makeRequest([
      [
        "Email/set",
        {
          accountId: this.accountId,
          update: {
            [emailId]: {
              mailboxIds: { [targetMailboxId]: true },
            },
          },
        },
        "0",
      ],
    ]);

    const [, result] = responses.find((r: any[]) => r[0] === "Email/set") || [];
    if (result?.notUpdated && Object.keys(result.notUpdated).length > 0) {
      throw new Error(
        `Failed to move email: ${JSON.stringify(result.notUpdated)}`,
      );
    }
  }

  /**
   * Performs an automated lookup of the user's designated `trash` label ID, and
   * moves the target email immediately outward to that box.
   *
   * @param emailId Target matching email string ID
   */
  async deleteEmail(emailId: string): Promise<void> {
    // Use cached trash ID, or look it up and cache for future calls
    if (!this.trashMailboxId) {
      const mailboxes = await this.getMailboxes();
      const trashFolder = mailboxes.find((m) => m.role === "trash");

      if (!trashFolder) {
        throw new Error("Could not find a Trash mailbox to move the email to.");
      }

      this.trashMailboxId = trashFolder.id;
    }

    await this.moveEmail(emailId, this.trashMailboxId);
  }
}
