const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const {shell} = require('electron')
const {AutoLanguageClient, DownloadFile} = require('atom-languageclient')

const serverDownloadUrl = 'http://download.eclipse.org/jdtls/snapshots/jdt-language-server-0.3.0-201708311739.tar.gz'
const serverDownloadSize = 31859061
const serverLauncher = '/plugins/org.eclipse.equinox.launcher_1.4.0.v20161219-1356.jar'

class JavaLanguageClient extends AutoLanguageClient {
  getGrammarScopes () { return [ 'source.java' ] }
  getLanguageName () { return 'Java' }
  getServerName () { return 'Eclipse JDT' }

  constructor () {
    super()
    this.statusElement = document.createElement('span')
    this.statusElement.className = 'inline-block'

    // TODO: Replace this with a workspace configuration system
    this.ignoreIncompleteClasspath = false
    this.commands = {
      'java.ignoreIncompleteClasspath': () => { this.ignoreIncompleteClasspath = true }
    }
  }

  startServerProcess () {
    const config = { 'win32': 'win', 'darwin': 'mac', 'linux': 'linux' }[process.platform]
    if (config == null) {
      throw Error(`${this.getServerName()} not supported on ${process.platform}`)
    }

    const serverHome = path.join(__dirname, '..', 'server')
    const command = this.getJavaCommand()

    return this.installServerIfRequired(serverHome)
      .then(() => {
        const args = [
          '-jar', path.join(serverHome, serverLauncher),
          '-configuration', path.join(serverHome, `config_${config}`)
        ]

        this.logger.debug(`starting "${command} ${args.join(' ')}"`)
        const childProcess = cp.spawn(command, args, { cwd: serverHome })
        childProcess.on('error', err =>
          atom.notifications.addError('Unable to start the Java language server.', {
            dismissable: true,
            buttons: [
              { text: 'Download Java', onDidClick: () => shell.openExternal('http://www.oracle.com/technetwork/java/javase/downloads/index.html') },
              { text: 'Set Java Path', onDidClick: () => atom.workspace.open("atom://config/packages/ide-java") },
              { text: 'Open Developer Tools', onDidClick: () => atom.openDevTools() }
            ],
            description: 'This can occur if you do not have Java 8 or later installed or if it is not in your path.'
          })
        )
        return childProcess
      }
    )
  }

  getJavaCommand () {
    const javaPath = this.getJavaPath()
    return javaPath == null ? 'java' : path.join(javaPath, 'bin', 'java')
  }

  getJavaPath () {
    return (new Array(
      atom.config.get('ide-java.javaHome'),
      process.env['JDK_HOME'],
      process.env['JAVA_HOME'])
    ).find(j => j)
  }

  installServerIfRequired (serverHome) {
    return this.isServerInstalled(serverHome)
      .then(doesExist => { if (!doesExist) return this.installServer(serverHome) })
  }

  isServerInstalled (serverHome) {
    return this.fileExists(path.join(serverHome, serverLauncher))
  }

  installServer (serverHome) {
    const localFileName = path.join(serverHome, 'download.tar.gz')
    const decompress = require('decompress')
    this.logger.log(`Downloading ${serverDownloadUrl} to ${localFileName}`);
    return this.fileExists(serverHome)
      .then(doesExist => { if (!doesExist) fs.mkdirSync(serverHome) })
      .then(() => DownloadFile(serverDownloadUrl, localFileName, (bytesDone, percent) => this.updateStatusBar(`downloading ${percent}%`), serverDownloadSize))
      .then(() => this.updateStatusBar('unpacking'))
      .then(() => decompress(localFileName, serverHome))
      .then(() => this.fileExists(path.join(serverHome, serverLauncher)))
      .then(doesExist => { if (!doesExist) throw Error(`Failed to install the ${this.getServerName()} language server`) })
      .then(() => this.updateStatusBar('installed'))
      .then(() => fs.unlinkSync(localFileName))
  }

  preInitialization(connection) {
    connection.onCustom('language/status', (e) => this.updateStatusBar(`${e.type.replace(/^Started$/, '')} ${e.message}`))
    connection.onCustom('language/actionableNotification', this.actionableNotification.bind(this))
  }

  updateStatusBar (text) {
    this.statusElement.textContent = `${this.name} ${text}`
  }

  actionableNotification (notification) {
    // Temporary until we have workspace configuration
    if (this.ignoreIncompleteClasspath && notification.message.includes('Classpath is incomplete')) return

    const options = { dismissable: true, detail: this.getServerName() }
    if (Array.isArray(notification.commands)) {
      options.buttons = notification.commands.map(c => ({ text: c.title, onDidClick: (e) => onActionableButton(e, c.command) }))
      // TODO: Deal with the actions
    }

    const notificationDialog = this.createNotification(notification.severity, notification.message, options)

    const onActionableButton = (event, commandName) => {
      const commandFunction = this.commands[commandName]
      if (commandFunction != null) {
        commandFunction()
      } else {
        console.log(`Unknown actionableNotification command '${commandName}'`)
      }
      notificationDialog.dismiss()
    }
  }

  createNotification (severity, message, options) {
    switch (severity) {
      case 1: return atom.notifications.addError(message, options)
      case 2: return atom.notifications.addWarning(message, options)
      case 3: return atom.notifications.addInfo(message, options)
      case 4: console.log(message)
    }
  }

  consumeStatusBar (statusBar) {
    this.statusTile = statusBar.addRightTile({ item: this.statusElement, priority: 1000 })
  }

  fileExists (path) {
    return new Promise((resolve, reject) => {
      fs.access(path, fs.R_OK, error => {
        resolve(!error || error.code !== 'ENOENT')
      })
    })
  }

  deleteFileIfExists (path) {
    return new Promise((resolve, reject) => {
      fs.unlink(path, error => {
        if (error && error.code !== 'ENOENT') { reject(error) } else { resolve() }
      })
    })
  }
}

module.exports = new JavaLanguageClient()
