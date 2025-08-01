import React, { useState } from 'react';

import Style from './JoinGroupByInviteCode.less';
import Dialog from '../../components/Dialog';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Message from '../../components/Message';
import { joinGroupByInviteCode } from '../../service';
import useAction from '../../hooks/useAction';

interface JoinGroupByInviteCodeProps {
    visible: boolean;
    onClose: () => void;
}

function JoinGroupByInviteCode(props: JoinGroupByInviteCodeProps) {
    const { visible, onClose } = props;
    const action = useAction();
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleJoinGroup() {
        if (!inviteCode.trim()) {
            Message.error('请输入邀请码');
            return;
        }

        if (inviteCode.length !== 6) {
            Message.error('邀请码格式不正确');
            return;
        }

        setLoading(true);
        try {
            const group = await joinGroupByInviteCode(inviteCode.toUpperCase());
            if (group) {
                group.type = 'group';
                action.addLinkman(group, true);
                setInviteCode('');
                onClose();
                Message.success('成功加入群组');
            }
        } catch (err) {
            Message.error('加入群组失败');
        } finally {
            setLoading(false);
        }
    }

    function handleInputChange(value: string) {
        // 只允许输入字母和数字，自动转换为大写
        const filteredValue = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        setInviteCode(filteredValue);
    }

    return (
        <Dialog title="通过邀请码加入群组" visible={visible} onClose={onClose}>
            <div className={Style.container}>
                <div className={Style.description}>
                    <p>请输入6位邀请码加入私有群组</p>
                </div>

                <div className={Style.inputSection}>
                    <label>邀请码：</label>
                    <Input
                        className={Style.inviteCodeInput}
                        value={inviteCode}
                        onChange={handleInputChange}
                        placeholder="请输入6位邀请码"
                        maxLength={6}
                    />
                </div>

                <div className={Style.actions}>
                    <Button
                        className={Style.joinButton}
                        onClick={handleJoinGroup}
                        loading={loading}
                        disabled={inviteCode.length !== 6}
                    >
                        加入群组
                    </Button>
                </div>

                <div className={Style.tips}>
                    <h4>注意事项：</h4>
                    <ul>
                        <li>邀请码为6位字母数字组合</li>
                        <li>邀请码区分大小写</li>
                        <li>邀请码有有效期限制</li>
                        <li>使用后邀请码会自动失效</li>
                        <li>只能加入私有群组</li>
                    </ul>
                </div>
            </div>
        </Dialog>
    );
}

export default JoinGroupByInviteCode; 