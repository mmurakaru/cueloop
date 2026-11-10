# Install the SDK and CLI

Use Bun 1.4.4 or Node 24 and later.
The package includes JavaScript, TypeScript declarations, and its database migrations.
Applications require PostgreSQL with logical replication and a Zero cache service.
Local hosting uses these same services.

```sh
npm install @cueloop/sync@alpha
npm install --global @cueloop/sync@alpha
cueloop-sync --help
```

Use the [application guide](./application-guide.md) to define a schema, permissions, and application handlers.
Use the [recovery guide](./recovery.md) to initialize, back up, restore, and migrate an authority.
Use the [workspace transfer guide](./workspace-transfer.md) to move one workspace between authorities.

## Optional short command

`cueloop-sync` is the package's executable.
On Unix, install the optional `cs` shortcut in a directory on your PATH:

```sh
cueloop-sync alias install --directory "$HOME/.local/bin"
cs --help
```

The installer creates a symbolic link to the installed standalone CLI.
It preserves an existing `cs` on PATH or at the destination, including files, directories, and dangling links.
A collision returns a `preserved` JSON result and exit status 1.
Use `cueloop-sync` when another program uses `cs`.
An existing link to this installation returns `already-installed` with exit status 0.
The installer does not edit shell configuration.

> [!NOTE]
> Keep the package installed at the link's target path.
> Reinstall the shortcut if you move the package or change the package manager's global installation directory.

## Embed in cueloop

Enable **Settings > Experimental > Multiplayer sync** to use `cueloop sync`.
Standalone SDK consumers can use the library without cueloop or its terminal renderer.
Importing a Thread into a remote authority remains an explicit action.
See the [Thread integration guide](../../daemon/SDK.md#workspace-authority) for the owner commands and credentials.
