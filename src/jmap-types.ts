import { z } from "zod";

// JMAP Session
export const JMAPSessionSchema = z.object({
  accounts: z.record(
    z.string(),
    z.object({
      name: z.string(),
      isPersonal: z.boolean(),
      isReadOnly: z.boolean(),
      accountCapabilities: z.record(z.string(), z.any()),
    }),
  ),
  primaryAccounts: z.record(z.string(), z.string()),
  username: z.string(),
  apiUrl: z.string(),
  downloadUrl: z.string(),
  uploadUrl: z.string(),
  eventSourceUrl: z.string(),
  state: z.string(),
});

export type JMAPSession = z.infer<typeof JMAPSessionSchema>;

// JMAP Core Requests/Responses
export const MethodCallSchema = z.tuple([
  z.string(), // Method name (e.g., 'Mailbox/get')
  z.record(z.string(), z.any()), // Arguments
  z.string(), // Method call ID
]);

export type MethodCall = z.infer<typeof MethodCallSchema>;

export const JMAPRequestSchema = z.object({
  using: z.array(z.string()),
  methodCalls: z.array(MethodCallSchema),
});

export type JMAPRequest = z.infer<typeof JMAPRequestSchema>;

export const MethodResponseSchema = z.tuple([
  z.string(), // Method name
  z.record(z.string(), z.any()), // Response arguments
  z.string(), // Method call ID
]);

export type MethodResponse = z.infer<typeof MethodResponseSchema>;

export const JMAPResponseSchema = z.object({
  methodResponses: z.array(MethodResponseSchema),
  sessionState: z.string().optional(),
});

export type JMAPResponse = z.infer<typeof JMAPResponseSchema>;

// Core Mailbox Types
export const MailboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  totalEmails: z.number(),
  unreadEmails: z.number(),
  totalThreads: z.number(),
  unreadThreads: z.number(),
  myRights: z.object({
    mayReadItems: z.boolean(),
    mayAddItems: z.boolean(),
    mayRemoveItems: z.boolean(),
    maySetSeen: z.boolean(),
    maySetKeywords: z.boolean(),
    mayCreateChild: z.boolean(),
    mayRename: z.boolean(),
    mayDelete: z.boolean(),
    maySubmit: z.boolean(),
  }),
  isSubscribed: z.boolean(),
});

export type Mailbox = z.infer<typeof MailboxSchema>;

// Core Email Types
export const EmailAddressSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string(),
});

export type EmailAddress = z.infer<typeof EmailAddressSchema>;

export const EmailSchema = z.object({
  id: z.string(),
  blobId: z.string(),
  threadId: z.string(),
  mailboxIds: z.record(z.string(), z.boolean()),
  keywords: z.record(z.string(), z.boolean()).default({}),
  size: z.number(),
  receivedAt: z.string(),
  subject: z.string().nullable().optional(),
  from: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  to: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  cc: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  bcc: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  replyTo: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  sentAt: z.string().nullable().optional(),
  hasAttachment: z.boolean().default(false),
  preview: z.string().nullable().optional(),
  bodyValues: z
    .record(
      z.string(),
      z.object({
        value: z.string(),
        isEncodingProblem: z.boolean().optional(),
        isTruncated: z.boolean().optional(),
      }),
    )
    .optional(),
  textBody: z
    .array(
      z.object({
        partId: z.string(),
        blobId: z.string().optional(),
        size: z.number().optional(),
        type: z.string(),
      }),
    )
    .optional(),
  htmlBody: z
    .array(
      z.object({
        partId: z.string(),
        blobId: z.string().optional(),
        size: z.number().optional(),
        type: z.string(),
      }),
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        partId: z.string().optional(),
        blobId: z.string(),
        size: z.number(),
        name: z.string().nullable().optional(),
        type: z.string(),
        disposition: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export type Email = z.infer<typeof EmailSchema>;

// JMAP Responses specific shapes
export const MailboxGetResponseSchema = z.object({
  accountId: z.string(),
  state: z.string(),
  list: z.array(MailboxSchema),
  notFound: z.array(z.string()).optional(),
});

export const EmailQueryResponseSchema = z.object({
  accountId: z.string(),
  queryState: z.string(),
  canCalculateSort: z.boolean().optional(),
  position: z.number(),
  total: z.number().optional(),
  ids: z.array(z.string()),
});

export const EmailGetResponseSchema = z.object({
  accountId: z.string(),
  state: z.string(),
  list: z.array(EmailSchema),
  notFound: z.array(z.string()).optional(),
});

// For sending emails
export const IdentitySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string(),
  replyTo: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  bcc: z
    .array(EmailAddressSchema)
    .optional()
    .nullable()
    .transform((val) => val ?? []),
  textSignature: z.string().optional(),
  htmlSignature: z.string().optional(),
  mayDelete: z.boolean().optional(),
});

export type Identity = z.infer<typeof IdentitySchema>;

export const IdentityGetResponseSchema = z.object({
  accountId: z.string(),
  state: z.string(),
  list: z.array(IdentitySchema),
  notFound: z.array(z.string()).optional(),
});
