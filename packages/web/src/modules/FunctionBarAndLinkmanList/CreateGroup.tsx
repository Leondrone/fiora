import React, { useState } from 'react';

import Style from './CreateGroup.less';
import Dialog from '../../components/Dialog';
import Input from '../../components/Input';
import Message from '../../components/Message';
import { createGroup } from '../../service';
import useAction from '../../hooks/useAction';

interface CreateGroupProps {
    visible: boolean;
    onClose: () => void;
}

function CreateGroup(props: CreateGroupProps) {
    const { visible, onClose } = props;
    const action = useAction();
    const [groupName, setGroupName] = useState('');
    const [priGroup, updatePriGroup] = useState('00')

    async function handleCreateGroup() {
        const group = await createGroup(groupName,priGroup);
        if (group) {
            group.type = 'group';
            action.addLinkman(group, true);
            setGroupName('');
            updatePriGroup(false)
            onClose();
            Message.success('创建群组成功');
        }
    }

    return (
        <Dialog title="创建群组" visible={visible} onClose={onClose}>
            <div className={Style.container}>
                <h3 className={Style.text}>请输入群组名</h3>
                <Input
                    className={Style.input}
                    value={groupName}
                    onChange={setGroupName}
                />
                <h3 className={Style.text}>私有群组</h3>
                <select
                    value={priGroup} // ...强制选择框的值与 state 相匹配...
                    onChange={e => updatePriGroup(e.target.value)} // ... 并在每次改变（change）时更新 state
                    >
                    <option value="00">公开</option>
                    <option value="01">私有</option>
                </select>
     
                <button
                    className={Style.button}
                    onClick={handleCreateGroup}
                    type="button"
                >
                    创建
                </button>
            </div>
        </Dialog>
    );
}

export default CreateGroup;
