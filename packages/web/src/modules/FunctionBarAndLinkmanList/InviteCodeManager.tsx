import React, { useState, useEffect } from 'react';

import Style from './InviteCodeManager.less';
import Dialog from '../../components/Dialog';
import Button from '../../components/Button';
import Message from '../../components/Message';
import { generateGroupInviteCode, getGroupInviteCodeInfo } from '../../service';

interface InviteCodeManagerProps {
    visible: boolean;
    onClose: () => void;
    groupId: string;
    groupName: string;
}

function InviteCodeManager(props: InviteCodeManagerProps) {
    const { visible, onClose, groupId, groupName } = props;
    const [inviteCode, setInviteCode] = useState('');
    const [expireTime, setExpireTime] = useState<number | null>(null);
    const [isExpired, setIsExpired] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expireHours, setExpireHours] = useState(24);

    useEffect(() => {
        if (visible && groupId) {
            loadInviteCodeInfo();
        }
    }, [visible, groupId]);

    async function loadInviteCodeInfo() {
        try {
            const result = await getGroupInviteCodeInfo(groupId);
            if (result.hasInviteCode) {
                setInviteCode(result.inviteCode);
                setExpireTime(result.expireTime);
                setIsExpired(result.isExpired);
            } else {
                setInviteCode('');
                setExpireTime(null);
                setIsExpired(false);
            }
        } catch (err) {
            console.error('获取邀请码信息失败:', err);
        }
    }

    async function handleGenerateInviteCode() {
        setLoading(true);
        try {
            const result = await generateGroupInviteCode(groupId, expireHours);
            setInviteCode(result.inviteCode);
            setExpireTime(result.expireTime);
            setIsExpired(false);
            Message.success('邀请码生成成功');
        } catch (err) {
            Message.error('生成邀请码失败');
        } finally {
            setLoading(false);
        }
    }

    function copyInviteCode() {
        if (inviteCode) {
            navigator.clipboard.writeText(inviteCode).then(() => {
                Message.success('邀请码已复制到剪贴板');
            }).catch(() => {
                Message.error('复制失败');
            });
        }
    }

    function formatExpireTime(timestamp: number) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN');
    }

    return (
        <Dialog title="邀请码管理" visible={visible} onClose={onClose}>
            <div className={Style.container}>
                <div className={Style.groupInfo}>
                    <h3>群组：{groupName}</h3>
                </div>

                {!inviteCode ? (
                    <div className={Style.generateSection}>
                        <h3>生成邀请码</h3>
                        <div className={Style.expireSelect}>
                            <label>有效期：</label>
                            <select
                                value={expireHours}
                                onChange={(e) => setExpireHours(Number(e.target.value))}
                            >
                                <option value={1}>1小时</option>
                                <option value={6}>6小时</option>
                                <option value={12}>12小时</option>
                                <option value={24}>24小时</option>
                                <option value={72}>3天</option>
                            </select>
                        </div>
                        <Button
                            className={Style.generateButton}
                            onClick={handleGenerateInviteCode}
                            loading={loading}
                        >
                            生成邀请码
                        </Button>
                    </div>
                ) : (
                    <div className={Style.inviteCodeSection}>
                        <h3>邀请码</h3>
                        <div className={Style.inviteCodeDisplay}>
                            <span className={Style.code}>{inviteCode}</span>
                            <Button onClick={copyInviteCode} size="small">
                                复制
                            </Button>
                        </div>
                        {expireTime && (
                            <div className={Style.expireInfo}>
                                <span>过期时间：{formatExpireTime(expireTime)}</span>
                                {isExpired && <span className={Style.expired}>（已过期）</span>}
                            </div>
                        )}
                        <div className={Style.actions}>
                            <Button onClick={handleGenerateInviteCode} loading={loading}>
                                重新生成
                            </Button>
                        </div>
                    </div>
                )}

                <div className={Style.tips}>
                    <h4>使用说明：</h4>
                    <ul>
                        <li>邀请码有效期为{expireHours}小时</li>
                        <li>使用后邀请码会自动失效</li>
                        <li>只有私有群组才能生成邀请码</li>
                        <li>只有群主才能管理邀请码</li>
                    </ul>
                </div>
            </div>
        </Dialog>
    );
}

export default InviteCodeManager; 