import React, { Component, Fragment } from 'react';
import Modal from 'components/Dialog/DesktopDialog';
import { bool, array, func } from 'prop-types';
import { Button, Table } from 'antd';
import { CloseOutlined, UndoOutlined } from '@ant-design/icons';
import withConfig from 'components/ConfigProvider/withConfig';


class StringSettingsModal extends Component {
  state = {
    removedLanguages: []
  }

  columns = [
    {
      title: "Languages",
      dataIndex: "label",
      key: "value",
      render: (_, {value, label}) => <Fragment>{`${label} (${value})`}</Fragment>
    },
    {
      title: "Default language",
      dataIndex: "value",
      key: "value",
      render: (_, { value }) => this.isDefault(value) ? "Default" : "",
    },
    {
      dataIndex: "value",
      key: "value",
      render: (_, {value}) => (
        <Fragment>
          <Button
            shape="circle"
            size="small"
            ghost
            icon={!this.isRemoved(value) ? <CloseOutlined /> : <UndoOutlined />}
            className="operator-controls__all-strings-settings-button"
            disabled={this.isDefault(value)}
            onClick={() => {
              !this.isRemoved(value) ? this.removeLanguage(value) : this.revert(value);
            }}
          />
          <span
            className="ml-2"
          >
            {!this.isRemoved(value) ? "Remove" : "Removed"}
          </span>
        </Fragment>
      ),
    }
  ]

  removeLanguage = (lang) => {
    this.setState(prevState => ({
      ...prevState,
      removedLanguages: [...prevState.removedLanguages, lang],
    }));
  }

  revert = (lang) => {
    this.setState(prevState => ({
      ...prevState,
      removedLanguages: prevState.removedLanguages.filter((key) => key !== lang),
    }));
  }

  isRemoved = (lang) => {
    const { removedLanguages } = this.state;
    return removedLanguages.includes(lang)
  }

  isDefault = (lang) => {
    const { defaultLanguage: DEFAULT_LANGUAGE } = this.props;
     return lang === DEFAULT_LANGUAGE
  }

  render() {
    const { isOpen, onCloseDialog, languages, onAddLanguageClick, onConfirm } = this.props;
    const { removedLanguages } = this.state;
    return (
      <Modal
        isOpen={isOpen}
        label="operator-controls-modal"
        className="operator-controls__modal"
        disableTheme={true}
        onCloseDialog={() => onCloseDialog(true)}
        shouldCloseOnOverlayClick={true}
        showCloseText={true}
        bodyOpenClassName="operator-controls__modal-open"
      >
        <div className="operator-controls__all-strings-header">
          <div className="operator-controls__modal-title">
            String settings
          </div>
        </div>
        <Table
          className="operator-controls__table"
          columns={this.columns}
          dataSource={languages}
          size="small"
          sticky={true}
          pagination={{
            pageSize: 1000,
            hideOnSinglePage: true,
            showSizeChanger: false,
            showQuickJumper: false,
            showLessItems: false,
            showTotal: false,
          }}
          scroll={{ y: 240 }}
          rowKey={({ value }) => value}
          style={{ width: '380px' }}
        />
        <div className="pt-3">
          <Button
            onClick={onAddLanguageClick}
            className="operator-controls__all-strings-settings-button"
            type="primary"
            shape="round"
            size="small"
            ghost
          >
            Add language
          </Button>
        </div>
        <div className="d-flex justify-content-end pt-4 mt-4">
          <Button
            type="primary"
            className="operator-controls__save-button confirm"
            onClick={() => onConfirm(removedLanguages)}
          >
            Confirm
          </Button>
        </div>
      </Modal>
    );
  }
}

StringSettingsModal.propTypes = {
  isOpen: bool.isRequired,
  onCloseDialog: func.isRequired,
  languages: array.isRequired,
  onAddLanguageClick: func.isRequired,
}

export default withConfig(StringSettingsModal);