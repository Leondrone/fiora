import assert, { AssertionError } from 'assert';
import { Types } from '@fiora/database/mongoose';
import stringHash from 'string-hash';
import crypto from 'crypto';

import config from '@fiora/config/server';
import getRandomAvatar from '@fiora/utils/getRandomAvatar';
import Group, { GroupDocument } from '@fiora/database/mongoose/models/group';
import Socket from '@fiora/database/mongoose/models/socket';
import Message from '@fiora/database/mongoose/models/message';
import { Redis, getGroupInviteCodeKey, getGroupInviteCodeByGroupKey } from '@fiora/database/redis/initRedis';

const { isValid } = Types.ObjectId;

/**
 * 获取指定群组的在线用户辅助方法
 * @param group 群组
 */
async function getGroupOnlineMembersHelper(group: GroupDocument) {
    const sockets = await Socket.find(
        {
            user: {
                $in: group.members.map((member) => member.toString()),
            },
        },
        {
            os: 1,
            browser: 1,
            environment: 1,
            user: 1,
        },
    ).populate('user', { username: 1, avatar: 1 });
    const filterSockets = sockets.reduce((result, socket) => {
        result.set(socket.user._id.toString(), socket);
        return result;
    }, new Map());
    return Array.from(filterSockets.values());
}

/**
 * 创建群组
 * @param ctx Context
 */
export async function createGroup(ctx: Context<{ name: string ; priGroup: string }>) {
    assert(!config.disableCreateGroup, '管理员已关闭创建群组功能');

    const ownGroupCount = await Group.count({ creator: ctx.socket.user });
    assert(
        ctx.socket.isAdmin || ownGroupCount < config.maxGroupsCount,
        `创建群组失败, 你已经创建了${config.maxGroupsCount}个群组`,
    );

    const { name, priGroup } = ctx.data;
    assert(name, '群组名不能为空');
    assert(priGroup, '群组类型不能为空');
    const group = await Group.findOne({ name });
    assert(!group, '该群组已存在');

    let newGroup = null;
    try {
        newGroup = await Group.create({
            name,
            avatar: getRandomAvatar(),
            creator: ctx.socket.user,
            members: [ctx.socket.user],
            priGroup,
        } as GroupDocument);
    } catch (err) {
        if (err.name === 'ValidationError') {
            return '群组名包含不支持的字符或者长度超过限制';
        }
        throw err;
    }

    ctx.socket.join(newGroup._id.toString());
    return {
        _id: newGroup._id,
        name: newGroup.name,
        avatar: newGroup.avatar,
        createTime: newGroup.createTime,
        creator: newGroup.creator,
        priGroup: newGroup.priGroup,
    };
}

/**
 * 加入群组
 * @param ctx Context
 */
export async function joinGroup(ctx: Context<{ groupId: string }>) {
    const { groupId } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '加入群组失败, 群组不存在' });
    }
    assert(group.members.indexOf(ctx.socket.user) === -1, '你已经在群组中');

    group.members.push(ctx.socket.user);
    await group.save();

    const messages = await Message.find(
        { toGroup: groupId },
        {
            type: 1,
            content: 1,
            from: 1,
            createTime: 1,
        },
        { sort: { createTime: -1 }, limit: 3 },
    ).populate('from', { username: 1, avatar: 1 });
    messages.reverse();

    ctx.socket.join(group._id.toString());

    return {
        _id: group._id,
        name: group.name,
        avatar: group.avatar,
        createTime: group.createTime,
        creator: group.creator,
        messages,
    };
}

/**
 * 退出群组
 * @param ctx Context
 */
export async function leaveGroup(ctx: Context<{ groupId: string }>) {
    const { groupId } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }

    // 默认群组没有creator
    if (group.creator) {
        assert(
            group.creator.toString() !== ctx.socket.user.toString(),
            '群主不可以退出自己创建的群',
        );
    }

    const index = group.members.indexOf(ctx.socket.user);
    assert(index !== -1, '你不在群组中');

    group.members.splice(index, 1);
    await group.save();

    ctx.socket.leave(group._id.toString());

    return {};
}

const GroupOnlineMembersCacheExpireTime = 1000 * 60;

/**
 * 获取群组在线成员
 */
function getGroupOnlineMembersWrapperV2() {
    const cache: Record<
        string,
        {
            key?: string;
            value: any;
            expireTime: number;
        }
    > = {};
    return async function getGroupOnlineMembersV2(
        ctx: Context<{ groupId: string; cache?: string }>,
    ) {
        const { groupId, cache: cacheKey } = ctx.data;
        assert(isValid(groupId), '无效的群组ID');

        if (
            cache[groupId] &&
            cache[groupId].key === cacheKey &&
            cache[groupId].expireTime > Date.now()
        ) {
            return { cache: cacheKey };
        }

        const group = await Group.findOne({ _id: groupId });
        if (!group) {
            throw new AssertionError({ message: '群组不存在' });
        }
        const result = await getGroupOnlineMembersHelper(group);
        const resultCacheKey = stringHash(
            result.map((item) => item.user._id).join(','),
        ).toString(36);
        if (cache[groupId] && cache[groupId].key === resultCacheKey) {
            cache[groupId].expireTime =
                Date.now() + GroupOnlineMembersCacheExpireTime;
            if (resultCacheKey === cacheKey) {
                return { cache: cacheKey };
            }
        }

        cache[groupId] = {
            key: resultCacheKey,
            value: result,
            expireTime: Date.now() + GroupOnlineMembersCacheExpireTime,
        };
        return {
            cache: resultCacheKey,
            members: result,
        };
    };
}
export const getGroupOnlineMembersV2 = getGroupOnlineMembersWrapperV2();

export async function getGroupOnlineMembers(
    ctx: Context<{ groupId: string; cache?: string }>,
) {
    const result = await getGroupOnlineMembersV2(ctx);
    return result.members;
}

/**
 * 获取默认群组的在线成员
 * 无需登录态
 */
function getDefaultGroupOnlineMembersWrapper() {
    let cache: any = null;
    let expireTime = 0;
    return async function getDefaultGroupOnlineMembers() {
        if (cache && expireTime > Date.now()) {
            return cache;
        }

        const group = await Group.findOne({ isDefault: true });
        if (!group) {
            throw new AssertionError({ message: '群组不存在' });
        }
        cache = await getGroupOnlineMembersHelper(group);
        expireTime = Date.now() + GroupOnlineMembersCacheExpireTime;
        return cache;
    };
}
export const getDefaultGroupOnlineMembers = getDefaultGroupOnlineMembersWrapper();

/**
 * 修改群头像, 只有群创建者有权限
 * @param ctx Context
 */
export async function changeGroupAvatar(
    ctx: Context<{ groupId: string; avatar: string }>,
) {
    const { groupId, avatar } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');
    assert(avatar, '头像地址不能为空');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }
    assert(
        group.creator.toString() === ctx.socket.user.toString(),
        '只有群主才能修改头像',
    );

    await Group.updateOne({ _id: groupId }, { avatar });
    return {};
}

/**
 * 修改群组头像, 只有群创建者有权限
 * @param ctx Context
 */
export async function changeGroupName(
    ctx: Context<{ groupId: string; name: string }>,
) {
    const { groupId, name } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');
    assert(name, '群组名称不能为空');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }
    assert(group.name !== name, '新群组名不能和之前一致');
    assert(
        group.creator.toString() === ctx.socket.user.toString(),
        '只有群主才能修改头像',
    );

    const targetGroup = await Group.findOne({ name });
    assert(!targetGroup, '该群组名已存在');

    await Group.updateOne({ _id: groupId }, { name });

    ctx.socket.emit(groupId, 'changeGroupName', { groupId, name });

    return {};
}

/**
 * 删除群组, 只有群创建者有权限
 * @param ctx Context
 */
export async function deleteGroup(ctx: Context<{ groupId: string }>) {
    const { groupId } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }
    assert(
        group.creator.toString() === ctx.socket.user.toString(),
        '只有群主才能解散群组',
    );
    assert(group.isDefault !== true, '默认群组不允许解散');

    await Group.deleteOne({ _id: group });

    ctx.socket.emit(groupId, 'deleteGroup', { groupId });

    return {};
}

export async function getGroupBasicInfo(ctx: Context<{ groupId: string }>) {
    const { groupId } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }

    return {
        _id: group._id,
        name: group.name,
        avatar: group.avatar,
        members: group.members.length,
    };
}

/**
 * 生成群组邀请码
 * @param ctx Context
 */
export async function generateGroupInviteCode(ctx: Context<{ groupId: string; expireHours?: number }>) {
    const { groupId, expireHours = 24 } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }

    // 只有私有群组才能生成邀请码
    assert(group.priGroup === '01', '只有私有群组才能生成邀请码');
    
    // 只有群主才能生成邀请码
    assert(
        group.creator.toString() === ctx.socket.user.toString(),
        '只有群主才能生成邀请码',
    );

    // 生成6位随机邀请码
    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    // 存储邀请码信息到Redis，包含群组ID和过期时间
    const inviteData = {
        groupId: groupId,
        creator: ctx.socket.user,
        expireTime: Date.now() + expireHours * 60 * 60 * 1000,
    };

    // 设置邀请码，24小时过期
    await Redis.set(
        getGroupInviteCodeKey(inviteCode),
        JSON.stringify(inviteData),
        Redis.Hour * expireHours
    );

    // 记录群组的邀请码，用于后续清理
    await Redis.set(
        getGroupInviteCodeByGroupKey(groupId),
        inviteCode,
        Redis.Hour * expireHours
    );

    return {
        inviteCode,
        expireTime: inviteData.expireTime,
        groupName: group.name,
    };
}

/**
 * 通过邀请码加入群组
 * @param ctx Context
 */
export async function joinGroupByInviteCode(ctx: Context<{ inviteCode: string }>) {
    const { inviteCode } = ctx.data;
    assert(inviteCode && inviteCode.length === 6, '邀请码格式不正确');

    // 从Redis获取邀请码信息
    const inviteDataStr = await Redis.get(getGroupInviteCodeKey(inviteCode));
    if (!inviteDataStr) {
        throw new AssertionError({ message: '邀请码不存在或已过期' });
    }

    const inviteData = JSON.parse(inviteDataStr);
    
    // 检查邀请码是否过期
    if (Date.now() > inviteData.expireTime) {
        // 删除过期的邀请码
        await Redis.expire(getGroupInviteCodeKey(inviteCode), 0);
        throw new AssertionError({ message: '邀请码已过期' });
    }

    const groupId = inviteData.groupId;
    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }

    // 检查用户是否已经在群组中
    assert(group.members.indexOf(ctx.socket.user) === -1, '你已经在群组中');

    // 将用户添加到群组
    group.members.push(ctx.socket.user);
    await group.save();

    // 获取群组最近的消息
    const messages = await Message.find(
        { toGroup: groupId },
        {
            type: 1,
            content: 1,
            from: 1,
            createTime: 1,
        },
        { sort: { createTime: -1 }, limit: 3 },
    ).populate('from', { username: 1, avatar: 1 });
    messages.reverse();

    // 加入群组socket房间
    ctx.socket.join(group._id.toString());

    // 删除已使用的邀请码
    await Redis.expire(getGroupInviteCodeKey(inviteCode), 0);
    await Redis.expire(getGroupInviteCodeByGroupKey(groupId), 0);

    return {
        _id: group._id,
        name: group.name,
        avatar: group.avatar,
        createTime: group.createTime,
        creator: group.creator,
        messages,
    };
}

/**
 * 获取群组的邀请码信息
 * @param ctx Context
 */
export async function getGroupInviteCodeInfo(ctx: Context<{ groupId: string }>) {
    const { groupId } = ctx.data;
    assert(isValid(groupId), '无效的群组ID');

    const group = await Group.findOne({ _id: groupId });
    if (!group) {
        throw new AssertionError({ message: '群组不存在' });
    }

    // 只有私有群组才能查看邀请码信息
    assert(group.priGroup === '01', '只有私有群组才能查看邀请码信息');
    
    // 只有群主才能查看邀请码信息
    assert(
        group.creator.toString() === ctx.socket.user.toString(),
        '只有群主才能查看邀请码信息',
    );

    // 获取群组的邀请码
    const inviteCode = await Redis.get(getGroupInviteCodeByGroupKey(groupId));
    if (!inviteCode) {
        return {
            hasInviteCode: false,
        };
    }

    // 获取邀请码详细信息
    const inviteDataStr = await Redis.get(getGroupInviteCodeKey(inviteCode));
    if (!inviteDataStr) {
        return {
            hasInviteCode: false,
        };
    }

    const inviteData = JSON.parse(inviteDataStr);
    
    return {
        hasInviteCode: true,
        inviteCode,
        expireTime: inviteData.expireTime,
        isExpired: Date.now() > inviteData.expireTime,
    };
}
