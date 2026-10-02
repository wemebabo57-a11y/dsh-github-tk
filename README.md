# dsh-github-tk
一个 DeepSeek Harness 插件，让会话直接读写 GitHub 仓库。仓库内容经 GitHub REST API 读取和提交；插件自身只在 DSH home 保存会话与仓库的关联信息，不克隆仓库，也不要求选择本地项目路径。

默认在选择云端仓库后，插件会隐藏并拒绝该会话中的本地文件、Shell、终端及其他非 GitHub 工具。AI 只能使用 `github_*` 工具（PTC 模式的 `run_code` 仅作为这些工具的调用载体）。因此仓库修改只能通过 GitHub API 发生，不会在本地工作区改完再上传。该限制在恢复历史会话时会自动恢复。

## 安装

需要已安装的 DSH。通过 DSH 命令直接从 GitHub 安装到 Web profile：

```powershell
dsh plugin --profile web add github:wemebabo57-a11y/dsh-github-tk
```

然后以该 profile 启动 DSH。`cordis.patch.yml` 会自动挂载插件。桌面端或其他 profile 只需替换 profile 名称：

```powershell
dsh plugin --profile desktop add github:wemebabo57-a11y/dsh-github-tk
```

本仓库提交了已构建的 `dist/` 文件，也不声明安装生命周期脚本或 DSH 的开发依赖，因此 GitHub 安装不需要 pnpm 的 `allowBuilds` 授权。更新插件执行：

```powershell
dsh plugin --profile web update dsh-github-tk
```

## 使用

```text
/github-token <你的 GitHub PAT>
/github list
/github owner/repo
```

`/github owner/repo branch` 可指定分支。`/github create name private` 会在当前用户账号下新建私有仓库并选中；`public` 创建公开仓库。

AI 可调用 `github_project`、`github_list_repositories`、`github_select_repository`、`github_create_repository`、`github_list_files`、`github_read_file`、`github_write_file`、`github_delete_file`。更新文件时先调用 `github_read_file` 获取 SHA，写入时带上 SHA；GitHub 发现冲突时会拒绝提交。删除同样要求当前 SHA。每次写入或删除都是 GitHub 上的真实提交，不会先改本地文件再上传。

## 界面范围

云端仓库通过命令选择，项目不占用本地 Workspace。DSH 内置的 Workspace 菜单只接受现存本地目录，因此插件不会把 GitHub 仓库伪装成该菜单中的本地 Workspace。

## 配置

默认的 Token 引用名是 `GITHUB_TOKEN`；会话关联默认保存在 `$DSH_HOME/github-cloud-projects.json`，若未设置 `DSH_HOME` 则在 `~/.dsh/github-cloud-projects.json`。可在 profile 的 `cordis.patch.yml` 里覆盖插件行配置：

```yaml
- id: github-cloud
  config:
    tokenRef: GITHUB_TOKEN
    statePath: /absolute/path/github-cloud-projects.json
```

此关联文件只含仓库标识和分支，不含 Token 或仓库内容。**但 DSH 的默认会话持久化会记录工具调用和结果**：`github_read_file` 返回的源码文本、`github_write_file` 的文件内容参数，可能进入本地会话日志或其他已启用的结果存储。因此本插件保证的是不创建本地仓库检出或源码工作树，不能保证本地磁盘完全没有源码文本。云端项目会话的本地文件与 Shell 工具会被强制拒绝。

远端权限由 GitHub Token 控制。插件当前支持 UTF-8 文本文件；GitHub Contents API 的文件大小与速率限制仍然适用。
