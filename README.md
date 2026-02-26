# Local Fastmail MCP Server

A locally-hosted [Model Context Protocol](https://modelcontextprotocol.io/) server that connects your Fastmail account to any MCP-compatible AI assistant (such as Claude Desktop, Cursor, or similar tools).

This integration leverages Fastmail's native [JMAP API](https://jmap.io/) and strictly typed TypeScript/Zod schemas to allow your AI assistant to read, manage, and interact with your inbox without relying on third-party webhook integrations or exposing credentials outward.

## Capabilities

Once connected, your AI assistant can use the following tools:

### `list_mailboxes`

Discover all labels, folders, and mailboxes in your account. Returns each mailbox's ID, name, role, unread/total counts, and permissions.

### `list_emails`

Query emails by folder, keyword search, or read/unread status. Supports pagination for large result sets.

| Parameter    | Type     | Description                                                            |
| ------------ | -------- | ---------------------------------------------------------------------- |
| `mailboxId`  | string?  | Filter by a specific mailbox ID (use `list_mailboxes` to discover IDs) |
| `query`      | string?  | Full-text search across email content                                  |
| `unreadOnly` | boolean? | Only return unread emails                                              |
| `limit`      | number?  | Max results per page (default: 20, max: 250)                           |
| `position`   | number?  | Zero-based offset for pagination                                       |

The response includes `emails`, `total`, `position`, and `hasMore`. To page through results, increment `position` by `limit` on each call until `hasMore` is `false`.

### `read_email`

Fetch the full content of a specific email by its ID.

| Parameter  | Type     | Description                                                                                                                       |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `emailId`  | string   | The exact ID of the email to read                                                                                                 |
| `textOnly` | boolean? | When `true`, only fetches text/plain content, skipping HTML. Ideal for newsletters and HTML-heavy emails to reduce response size. |

### `send_email`

Draft and send a new email from your Fastmail account.

| Parameter | Type   | Description               |
| --------- | ------ | ------------------------- |
| `to`      | string | Destination email address |
| `subject` | string | Subject line              |
| `body`    | string | Plain text body content   |

### `mark_email_read`

Mark a specific email as read or unread.

| Parameter | Type     | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `emailId` | string   | The exact ID of the email                            |
| `read`    | boolean? | `true` to mark as read (default), `false` for unread |

### `move_email`

Transfer an email to a different mailbox/folder.

| Parameter   | Type   | Description                       |
| ----------- | ------ | --------------------------------- |
| `emailId`   | string | The exact ID of the email to move |
| `mailboxId` | string | The destination mailbox ID        |

### `delete_email`

Move an email to the Trash mailbox.

| Parameter | Type   | Description                         |
| --------- | ------ | ----------------------------------- |
| `emailId` | string | The exact ID of the email to delete |

---

## Security Approach

This server uses `stdio` transport exclusively — it never exposes an external HTTP port. Credentials are stored locally in your `.env` file or passed via the MCP client's environment configuration. All communication is directly between your local machine and the official `api.fastmail.com/jmap` endpoints.

---

## Installation & Setup

### 1. Requirements

Ensure you have installed [Node.js](https://nodejs.org/) (version 22+ recommended) and `npm` on your local machine.

### 2. Configure your Fastmail API Token

1. Log into your Fastmail Account.
2. Go to `Settings` -> `Privacy & Security` -> `Connected apps & API tokens`.
3. Click _New API Token_.
4. Name the token (e.g. "AI MCP Server")
5. Provide the token the following scopes:
   - `Email` (required for reading and listing)
   - `Email submission` (required for sending emails)
6. Copy the generated API token securely.

### 3. Local Project Setup

Clone the repository and install the required dependencies:

```bash
npm install
```

Copy the example environment variables file:

```bash
cp .env.example .env
```

Open `.env` in your text editor and paste in your credentials:

```bash
FASTMAIL_EMAIL=your_email@fastmail.com
FASTMAIL_API_TOKEN=fmu1-your-secret-token-here
```

### 4. Build the Project

Compile the TypeScript framework down into native JavaScript execution logic:

```bash
npm run build
```

---

## Connecting to an MCP Client

This server works with any MCP-compatible client. Below is an example using Claude Desktop.

### Claude Desktop

1. Open Claude Desktop and choose Settings -> Developer -> Edit Config
   Open claude_desktop_config.json

2. Add this to the mcpServers section, fixing the path to the compiled index.js file and adding your own credentials:

```json
{
  "mcpServers": {
    "local-fastmail": {
      "command": "node",
      "args": ["/absolute/path/to/your/local-fastmail-mcp/dist/index.js"],
      "env": {
        "FASTMAIL_EMAIL": "your_email@fastmail.com",
        "FASTMAIL_API_TOKEN": "fmu1-your-secret-token-here"
      }
    }
  }
}
```

3. Restart Claude Desktop. The new tools will appear instantly and you can start typing "Summarize my 20 most recent unread emails."

For other MCP clients, consult their documentation on how to register a local `stdio` server pointing at `dist/index.js` with the required environment variables.

---

## Development & Testing

This project is built using TypeScript, `@modelcontextprotocol/sdk`, and Zod parsing.

If you are developing new Tools or making adjustments to the Fastmail capabilities:

1. Compile: Always ensure you run `npm run build` after making modifications.
2. Testing: Run the native Vitest coverage harness by executing:

```bash
npm test
```

Pull requests are welcome! Please open an issue first to discuss what you'd like to change. I plan to be picky, though, so also feel free to fork and make your own version.
