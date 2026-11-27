import { z } from "zod";

export const commentReplyNotificationSchema = z.object({
  threadId: z.string(),
  threadTitle: z.string(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  commentId: z.string(),
  kind: z.enum(["diff", "file"]),
  path: z.string(),
  line: z.number(),
  endLine: z.number().optional(),
  question: z.string(),
  answer: z.string(),
  answeredBy: z.string(),
  answeredAt: z.string(),
  resolved: z.boolean(),
});

export type CommentReplyNotification = z.infer<typeof commentReplyNotificationSchema>;

export const commentReplyNotificationsSchema = z.object({
  replies: z.array(commentReplyNotificationSchema),
});

export type CommentReplyNotifications = z.infer<typeof commentReplyNotificationsSchema>;
