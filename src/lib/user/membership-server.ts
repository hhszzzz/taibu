import { isMembershipExpired, type MembershipType } from "@/lib/user/membership";
import { systemDb, type ScopedDb } from "@/lib/db/context.server";

export class MembershipResolutionError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'MembershipResolutionError';
        if (options && 'cause' in options) {
            Object.defineProperty(this, 'cause', {
                value: options.cause,
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
    }
}

export async function getEffectiveMembershipType(
    userId: string,
    options?: { db?: ScopedDb },
): Promise<MembershipType> {
    try {
        const data = await (options?.db ?? systemDb()).tx((trx) => trx
            .selectFrom("users")
            .select(["membership", "membership_expires_at"])
            .where("id", "=", userId)
            .executeTakeFirst());

        if (!data) {
            console.error("[membership] Missing membership row for user:", userId);
            throw new MembershipResolutionError('获取会员状态失败');
        }

        const membership = (data.membership || "free") as MembershipType;

        if (isMembershipExpired({ membership, membership_expires_at: data.membership_expires_at })) {
            return "free";
        }

        return membership;
    } catch (error) {
        if (error instanceof MembershipResolutionError) {
            throw error;
        }
        console.error("[membership] Failed to resolve membership:", error);
        throw new MembershipResolutionError('获取会员状态失败', { cause: error });
    }
}
