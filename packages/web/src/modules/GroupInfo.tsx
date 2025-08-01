import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { getOSSFileUrl } from '../utils/uploadFile';
import Dialog from '../components/Dialog';
import Avatar from '../components/Avatar';
import Button from '../components/Button';
import { State } from '../state/reducer';
import useAction from '../hooks/useAction';
import { joinGroup, getLinkmanHistoryMessages, getGroupBasicInfo } from '../service';
import InviteCodeManager from './FunctionBarAndLinkmanList/InviteCodeManager';

import Style from './InfoDialog.less';

interface GroupInfoProps {
    visible: boolean;
    group?: {
        _id: string;
        name: string;
        avatar: string;
        members: number;
        priGroup?: string;
        creator?: string;
    };
    onClose: () => void;
}

function GroupInfo(props: GroupInfoProps) {
    const { visible, onClose, group } = props;

    const action = useAction();
    const hasLinkman = useSelector(
        (state: State) => !!state.linkmans[group?._id as string],
    );
    const [largerAvatar, toggleLargetAvatar] = useState(false);
    const [inviteCodeManagerVisible, setInviteCodeManagerVisible] = useState(false);
    const currentUser = useSelector((state: State) => state.user);
    
    // 检查是否为私有群组
    const isPrivateGroup = group?.priGroup === '01';
    // 检查是否为群主
    const isGroupCreator = group?.creator === currentUser?._id;

    if (!group) {
        return null;
    }

    async function handleJoinGroup() {
        onClose();

        if (!group) {
            return;
        }
        const groupRes = await joinGroup(group._id);
        if (groupRes) {
            groupRes.type = 'group';
            action.addLinkman(groupRes, true);

            const messages = await getLinkmanHistoryMessages(group._id, 0);
            if (messages) {
                action.addLinkmanHistoryMessages(group._id, messages);
            }
        }
    }

    function handleFocusGroup() {
        onClose();

        if (!group) {
            return;
        }
        action.setFocus(group._id);
    }

    return (
        <Dialog
            className={Style.infoDialog}
            visible={visible}
            onClose={onClose}
        >
            <div className={Style.coantainer}>
                <div className={Style.header}>
                    <Avatar
                        size={60}
                        src={group.avatar}
                        onMouseEnter={() => toggleLargetAvatar(true)}
                        onMouseLeave={() => toggleLargetAvatar(false)}
                    />
                    <img
                        className={`${Style.largeAvatar} ${
                            largerAvatar ? 'show' : 'hide'
                        }`}
                        src={getOSSFileUrl(group.avatar)}
                        alt="群组头像"
                    />
                    <p>{group.name}</p>
                </div>
                <div className={Style.info}>
                    <div className={Style.onlineStatus}>
                        <p className={Style.onlineText}>成员:</p>
                        <div>{group.members}人</div>
                    </div>
                    {isPrivateGroup && (
                        <div className={Style.groupType}>
                            <p className={Style.onlineText}>类型:</p>
                            <div>私有群组</div>
                        </div>
                    )}
                    {hasLinkman ? (
                        <Button onClick={handleFocusGroup}>发送消息</Button>
                    ) : (
                        <Button onClick={handleJoinGroup}>加入群组</Button>
                    )}
                    {isPrivateGroup && isGroupCreator && (
                        <Button 
                            onClick={() => setInviteCodeManagerVisible(true)}
                            style={{ marginTop: '10px' }}
                        >
                            管理邀请码
                        </Button>
                    )}
                </div>
            </div>
            <InviteCodeManager
                visible={inviteCodeManagerVisible}
                onClose={() => setInviteCodeManagerVisible(false)}
                groupId={group._id}
                groupName={group.name}
            />
        </Dialog>
    );
}

export default GroupInfo;
