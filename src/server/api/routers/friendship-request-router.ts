import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { authGuard } from '@/server/trpc/middlewares/auth-guard'
import { procedure } from '@/server/trpc/procedures'
import { IdSchema } from '@/utils/server/base-schemas'
import { router } from '@/server/trpc/router'

const SendFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canSendFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = SendFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('users')
      .where('users.id', '=', friendUserId)
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow(
        () =>
          new TRPCError({
            code: 'BAD_REQUEST',
          })
      )

    return next({ ctx })
  }
)

const AnswerFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canAnswerFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('friendships')
      .where('friendships.userId', '=', friendUserId)
      .where('friendships.friendUserId', '=', ctx.session.userId)
      .where(
        'friendships.status',
        '=',
        FriendshipStatusSchema.Values['requested']
      )
      .select('friendships.id')
      .limit(1)
      .executeTakeFirstOrThrow(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
        })
      })

    return next({ ctx })
  }
)

export const friendshipRequestRouter = router({
  send: procedure
    .use(canSendFriendshipRequest)
    .input(SendFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 3: Fix bug
       *
       * Fix a bug where our users could not send a friendship request after
       * they'd previously been declined. Steps to reproduce:
       *  1. User A sends a friendship request to User B
       *  2. User B declines the friendship request
       *  3. User A tries to send another friendship request to User B -> ERROR
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 3
       *  - Run `yarn test` to verify your answer
       */
      const existingRequest = await ctx.db
        .selectFrom('friendships')
        .where('userId', '=', ctx.session.userId)
        .where('friendUserId', '=', input.friendUserId)
        .where('status', '=', FriendshipStatusSchema.Values['declined'])
        .select('id')
        .executeTakeFirst()
      if (existingRequest) {
        // Nếu có yêu cầu kết bạn bị từ chối, cập nhật lại trạng thái thành 'requested'
        await ctx.db
          .updateTable('friendships')
          .set({
            status: FriendshipStatusSchema.Values['requested'],
          })
          .where('id', '=', existingRequest.id)
          .execute()
      } else {
        // Nếu không có, tạo một yêu cầu kết bạn mới
        await ctx.db
          .insertInto('friendships')
          .values({
            userId: ctx.session.userId,
            friendUserId: input.friendUserId,
            status: FriendshipStatusSchema.Values['requested'],
          })
          .execute()
      }
    }),

  accept: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        // 1. Cập nhật yêu cầu kết bạn hiện tại để có trạng thái 'được chấp nhận'
        await t
          .updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['accepted'] })
          .where('userId', '=', input.friendUserId)
          .where('friendUserId', '=', ctx.session.userId)
          .where('status', '=', FriendshipStatusSchema.Values['requested'])
          .execute()
        // 2. Tạo bản ghi yêu cầu kết bạn mới với người dùng đối diện là bạn bè
        // Kiểm tra xem bản ghi yêu cầu kết bạn ngược lại đã tồn tại chưa
        const existingOppositeRequest = await t
          .selectFrom('friendships')
          .where('userId', '=', ctx.session.userId)
          .where('friendUserId', '=', input.friendUserId)
          .where('status', '=', FriendshipStatusSchema.Values['requested'])
          .select('id')
          .executeTakeFirst()

        // Nếu bản ghi yêu cầu kết bạn ngược lại không tồn tại, tạo mới
        if (!existingOppositeRequest) {
          await t
            .insertInto('friendships')
            .values({
              userId: ctx.session.userId,
              friendUserId: input.friendUserId,
              status: FriendshipStatusSchema.Values['accepted'],
            })
            .execute()
        } else {
          await t
            .updateTable('friendships')
            .set({ status: FriendshipStatusSchema.Values['accepted'] })
            .where('id', '=', existingOppositeRequest.id)
            .execute()
        }
      })
    }),

  decline: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 2: Implement api to decline a friendship request
       *
       * Set the friendship request status to `declined`
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 2
       *  - Run `yarn test` to verify your answer
       *
       * Documentation references:
       *  - https://vitest.dev/api/#test-skip
       */
      await ctx.db.transaction().execute(async (t) => {
        await t
          .updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['declined'] })
          .where('userId', '=', input.friendUserId)
          .where('friendUserId', '=', ctx.session.userId)
          .where('status', '=', FriendshipStatusSchema.Values['requested'])
          .execute()
      })
    }),
})
