/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        DirNew command
 * CVM-Role:        <none>
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This command creates a new directory.
 *
 * END HEADER
 */

import ZettlrCommand from './zettlr-command'
import { trans } from '../../common/i18n-main'
import path from 'path'
import sanitize from 'sanitize-filename'

export default class DirNew extends ZettlrCommand {
  constructor (app: any) {
    super(app, 'dir-new')
  }

  /**
    * Create a new directory.
    * @param {String} evt The event name
    * @param  {Object} arg An object containing hash of containing and name of new dir.
    */
  async run (evt: string, arg: any): Promise<boolean> {
    let sourceDir = this._app.findDir(arg.path)
    if (sourceDir === null) {
      global.log.error('Could not create directory: No source given.', arg)
      this._app.prompt({
        type: 'error',
        title: trans('system.error.could_not_create_dir'),
        message: trans('system.error.could_not_create_dir')
      })
      return false
    }

    const sanitizedName = (arg.name !== undefined) ? sanitize(arg.name.trim(), { replacement: '-' }) : trans('dialog.dir_new.value')

    if (sanitizedName.length === 0) {
      global.log.error('New directory name was empty after sanitization.', arg)
      this._app.prompt({
        type: 'error',
        title: trans('system.error.could_not_create_dir'),
        message: trans('system.error.could_not_create_dir')
      })
      return false
    }

    try {
      await this._app.getFileSystem().createDir(sourceDir, sanitizedName)
    } catch (e) {
      this._app.prompt({
        type: 'error',
        title: trans('system.error.could_not_create_dir'),
        message: e.message
      })
      return false
    }

    // Now the dir should be created, the FSAL will automatically notify the
    // application of the changes, so all we have to do is set the directory
    // as the new current directory.
    let newDirPath = path.join(sourceDir.path, sanitizedName)
    this._app.getFileSystem().openDirectory = this._app.findDir(newDirPath)

    return true
  }
}
