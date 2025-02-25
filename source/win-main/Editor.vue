<template>
  <div
    id="editor"
    ref="editor"
    v-bind:style="{ 'font-size': `${fontSize}px` }"
    v-bind:class="{
      'monospace': !isMarkdown,
      'fullscreen': distractionFree
    }"
    v-on:wheel="onEditorScroll($event)"
    v-on:mousedown="editorMousedown($event)"
    v-on:mouseup="editorMouseup($event)"
    v-on:mousemove="editorMousemove($event)"
  >
    <div v-show="showSearch" id="editor-search">
      <div class="row">
        <input
          ref="search-input"
          v-model="query"
          type="text"
          v-bind:placeholder="findPlaceholder"
          v-bind:class="{'monospace': regexpSearch }"
          v-on:keypress.enter.exact="searchNext()"
          v-on:keypress.shift.enter.exact="searchPrevious()"
          v-on:keydown.esc.exact="showSearch = false"
        >
        <button
          v-bind:title="regexLabel"
          v-bind:class="{ 'active': regexpSearch }"
          v-on:click="toggleQueryRegexp()"
        >
          <clr-icon shape="regexp"></clr-icon>
        </button>
        <button
          v-bind:title="closeLabel"
          v-on:click="showSearch = false"
        >
          <clr-icon shape="times"></clr-icon>
        </button>
      </div>
      <div class="row">
        <input
          v-model="replaceString"
          type="text"
          v-bind:placeholder="replacePlaceholder"
          v-bind:class="{'monospace': regexpSearch }"
          v-on:keypress.enter.exact="replaceNext()"
          v-on:keypress.shift.enter.exact="replacePrevious()"
          v-on:keypress.alt.enter.exact="replaceAll()"
          v-on:keydown.esc.exact="showSearch = false"
        >
        <button
          v-bind:title="replaceNextLabel"
          v-on:click="replaceNext()"
        >
          <clr-icon shape="two-way-arrows"></clr-icon>
        </button>
        <button
          v-bind:title="replaceAllLabel"
          v-on:click="replaceAll()"
        >
          <clr-icon shape="step-forward-2"></clr-icon>
        </button>
      </div>
    </div>
    <textarea id="cm-text" ref="textarea" style="display:none;"></textarea>
  </div>
</template>

<script>
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Editor
 * CVM-Role:        View
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This displays the main editor for the app. It uses the
 *                  MarkdownEditor class to implement the full CodeMirror editor.
 *
 * END HEADER
 */

import countWords from '../common/util/count-words'
import MarkdownEditor from '../common/modules/markdown-editor'
import CodeMirror from 'codemirror'
import { util as citrUtil, parseSingle } from '@zettlr/citr'
import objectToArray from '../common/util/object-to-array'
import { trans } from '../common/i18n-renderer'
import extractYamlFrontmatter from '../common/util/extract-yaml-frontmatter'
import YAML from 'yaml'

const ipcRenderer = window.ipc

export default {
  name: 'Editor',
  components: {
  },
  props: {
    readabilityMode: {
      type: Boolean,
      default: false
    },
    distractionFree: {
      type: Boolean,
      default: false
    }
  },
  data: function () {
    return {
      editor: null,
      openDocuments: [], // Contains all loaded documents if applicable
      currentlyFetchingFiles: [], // Contains the paths of files that are right now being fetched
      // Should we perform a regexp search?
      regexpSearch: false,
      showSearch: false, // Set to true to show the search box
      query: '', // Models the search value
      replaceString: '', // Models the replace string
      findTimeout: undefined, // Holds a timeout so that not every single keypress results in a searchNext
      // END: Search options
      activeDocument: null, // Almost like activeFile, only with additional info
      anchor: undefined
    }
  },
  computed: {
    findPlaceholder: function () {
      return trans('dialog.find.find_placeholder')
    },
    replacePlaceholder: function () {
      return trans('dialog.find.replace_placeholder')
    },
    replaceNextLabel: function () {
      return trans('dialog.find.replace_next_label')
    },
    replaceAllLabel: function () {
      return trans('dialog.find.replace_all_label')
    },
    closeLabel: function () {
      return trans('dialog.find.close_label')
    },
    regexLabel: function () {
      return trans('dialog.find.regex_label')
    },
    activeFile: function () {
      return this.$store.state.activeFile
    },
    isMarkdown: function () {
      if (this.activeFile === null) {
        return true // By default, assume Markdown
      }

      return this.resolveMode(this.activeFile.ext) === 'multiplex'
    },
    openFiles: function () {
      return this.$store.state.openFiles
    },
    fontSize: function () {
      return this.$store.state.config['editor.fontSize']
    },
    shouldCountChars: function () {
      return this.$store.state.config['editor.countChars']
    },
    editorConfiguration: function () {
      // We update everything, because not so many values are actually updated
      // right after setting the new configurations. Plus, the user won't update
      // everything all the time, but rather do one initial configuration, so
      // even if we incur a performance penalty, it won't be noticed that much.
      const doubleQuotes = this.$store.state.config['editor.autoCorrect.magicQuotes.primary'].split('…')
      const singleQuotes = this.$store.state.config['editor.autoCorrect.magicQuotes.secondary'].split('…')
      return {
        keyMap: this.$store.state.config['editor.inputMode'],
        autoCorrect: {
          style: this.$store.state.config['editor.autoCorrect.style'],
          quotes: {
            single: {
              start: singleQuotes[0],
              end: singleQuotes[1]
            },
            double: {
              start: doubleQuotes[0],
              end: doubleQuotes[1]
            }
          },
          replacements: this.$store.state.config['editor.autoCorrect.replacements']
        },
        zettlr: {
          imagePreviewWidth: this.$store.state.config['display.imageWidth'],
          imagePreviewHeight: this.$store.state.config['display.imageHeight'],
          markdownBoldFormatting: this.$store.state.config['editor.boldFormatting'],
          markdownItalicFormatting: this.$store.state.config['editor.italicFormatting'],
          muteLines: this.$store.state.config['muteLines'],
          scrollZoom: this.$store.state.config['editor.scrollZoom'],
          zettelkasten: {
            idRE: this.$store.state.config['zkn.idRE'],
            idGen: this.$store.state.config['zkn.idGen'],
            linkStart: this.$store.state.config['zkn.linkStart'],
            linkEnd: this.$store.state.config['zkn.linkEnd'],
            linkWithFilename: this.$store.state.config['zkn.linkWithFilename'] // ,
            // autoCreateLinkedFiles: this.$store.state.config['zkn.autoCreateLinkedFiles'],
            // autoSearch: this.$store.state.config['zkn.autoSearch']
          },
          readabilityAlgorithm: this.$store.state.config['editor.readabilityAlgorithm'],
          render: {
            citations: this.$store.state.config['display.renderCitations'],
            iframes: this.$store.state.config['display.renderIframes'],
            images: this.$store.state.config['display.renderImages'],
            links: this.$store.state.config['display.renderLinks'],
            math: this.$store.state.config['display.renderMath'],
            tasks: this.$store.state.config['display.renderTasks'],
            headingTags: this.$store.state.config['display.renderHTags'],
            tables: this.$store.state.config['editor.enableTableHelper']
          }
        }
      }
    },
    tagDatabase: function () {
      return this.$store.state.tagDatabase
    },
    cslItems: function () {
      return this.$store.state.cslItems
    },
    fsalFiles: function () {
      const tree = this.$store.state.fileTree
      const files = []

      for (const item of tree) {
        if (item.type === 'directory') {
          const contents = objectToArray(item, 'children').filter(descriptor => descriptor.type === 'file')
          files.push(...contents)
        } else if (item.type === 'file') {
          files.push(item)
        }
      }

      return files
    }
  },
  watch: {
    cslItems: function () {
      // We have received new items, so we should update them in the editor.
      const items = this.cslItems.map(item => {
        // Get a rudimentary author list
        let authors = ''
        if (item.author !== undefined) {
          authors = item.author.map(author => {
            if (author.family !== undefined) {
              return author.family
            } else if (author.literal !== undefined) {
              return author.literal
            } else {
              return undefined
            }
          }).filter(elem => elem !== undefined).join(', ')
        }

        let title = ''
        if (item.title !== undefined) {
          title = item.title
        } else if (item['container-title'] !== undefined) {
          title = item['container-title']
        }

        // This is just a very crude representation of the citations.
        return {
          text: item.id,
          displayText: `${item.id}: ${authors} - ${title}`
        }
      })
      this.editor.setCompletionDatabase('citekeys', items)
    },
    readabilityMode: function () {
      this.editor.readabilityMode = this.readabilityMode
    },
    distractionFree: function () {
      this.editor.distractionFree = this.distractionFree
    },
    editorConfiguration: function () {
      // Update the editor configuration, if anything changes.
      this.editor.setOptions(this.editorConfiguration)
    },
    tagDatabase: function () {
      this.editor.setCompletionDatabase('tags', this.tagDatabase)
    },
    fsalFiles: function () {
      const fileDatabase = {}

      for (let file of this.fsalFiles) {
        let fname = file.name.substr(0, file.name.lastIndexOf('.'))
        let displayText = fname // Fallback: Only filename
        if ('frontmatter' in file && file.frontmatter !== null && file.frontmatter.title !== undefined) {
          // (Else) if there is a frontmatter, use that title
          displayText = file.frontmatter.title
        } else if (Boolean(this.$store.state.config['display.useFirstHeadings']) && file.firstHeading != null) {
          // The user wants to use first headings as fallbacks
          displayText = file.firstHeading
        }

        if (file.id !== '') {
          displayText = `${file.id}: ${displayText}`
        }

        fileDatabase[fname] = {
          // Use the ID, if given, or the filename
          'text': (file.id !== '') ? file.id : fname,
          'displayText': displayText,
          'id': file.id
        }
      }

      this.editor.setCompletionDatabase('files', fileDatabase)
    },
    activeFile: function () {
      if (this.editor === null) {
        console.error('Received a file update but the editor was not yet initiated!')
        return
      }

      if (this.activeFile === null) {
        this.editor.swapDoc(CodeMirror.Doc('', 'multiplex'), 'multiplex')
        this.editor.readOnly = true
        this.$store.commit('updateTableOfContents', this.editor.tableOfContents)
        // Update the citation keys with an empty array
        this.updateCitationKeys()
        return
      }

      const doc = this.openDocuments.find(doc => doc.path === this.activeFile.path)

      if (doc !== undefined) {
        // Simply swap it
        this.editor.setOptions({
          zettlr: { markdownImageBasePath: this.activeFile.dir }
        })
        this.editor.swapDoc(doc.cmDoc, doc.mode)
        this.activeDocument = doc
        this.editor.readOnly = false
        this.$store.commit('updateTableOfContents', this.editor.tableOfContents)
        this.$store.commit('activeDocumentInfo', this.editor.documentInfo)
        // Update the citation keys
        this.updateCitationKeys()
      } else if (this.currentlyFetchingFiles.includes(this.activeFile.path) === false) {
        // We have to request the document beforehand
        this.currentlyFetchingFiles.push(this.activeFile.path)
        ipcRenderer.invoke('application', { command: 'get-file-contents', payload: this.activeFile.path })
          .then((descriptorWithContent) => {
            const mode = this.resolveMode(this.activeFile.ext)
            const newDoc = {
              path: descriptorWithContent.path,
              mode: mode, // Save the mode for later swaps
              cmDoc: CodeMirror.Doc(descriptorWithContent.content, mode),
              modified: false,
              lastWordCount: countWords(descriptorWithContent.content, this.shouldCountChars)
            }

            // Listen to change events on the doc, because if the user pastes
            // more than ten words at once, we need to substract it to not
            // mess with the word count.
            newDoc.cmDoc.on('change', (doc, changeObj) => {
              if (changeObj.origin !== 'paste') {
                return
              }

              const newTextWords = countWords(changeObj.text.join(' '), this.shouldCountChars)
              if (newTextWords > 10) {
                newDoc.lastWordCount = countWords(newDoc.cmDoc.getValue(), this.shouldCountChars)
              }
            })
            this.openDocuments.push(newDoc)
            const idx = this.currentlyFetchingFiles.findIndex(e => e === descriptorWithContent.path)
            this.currentlyFetchingFiles.splice(idx, 1)
            // Let's check whether the active file has in the meantime changed
            // If it has, don't overwrite the current one
            if (this.activeFile.path === descriptorWithContent.path) {
              this.editor.setOptions({
                zettlr: { markdownImageBasePath: this.activeFile.dir }
              })
              this.editor.swapDoc(newDoc.cmDoc, newDoc.mode)
              this.activeDocument = newDoc
              this.editor.readOnly = false
              this.$store.commit('updateTableOfContents', this.editor.tableOfContents)
              this.$store.commit('activeDocumentInfo', this.editor.documentInfo)
              this.updateCitationKeys()
            }
          })
          .catch(e => console.error(e))
      } // Else: The file might currently being fetched, so let's wait ...
    },
    openFiles: function () {
      // The openFiles array in the store has changed --> remove all documents
      // that are not present anymore
      for (const doc of this.openDocuments) {
        const found = this.openFiles.find(descriptor => descriptor.path === doc.path)
        if (found === undefined) {
          // Remove the document from our array
          const idx = this.openDocuments.indexOf(doc)
          this.openDocuments.splice(idx, 1)
        }
      }
    },
    query: function () {
      // Make sure to switch the regexp search depending on the search input
      const isRegexp = /^\/.+\/[gimy]{0,4}$/.test(this.query)
      if (isRegexp && this.regexpSearch === false) {
        this.regexpSearch = true
      } else if (!isRegexp && this.regexpSearch === true) {
        this.regexpSearch = false
      }

      // Begin a search
      if (this.findTimeout !== undefined) {
        clearTimeout(this.findTimeout)
        this.findTimeout = undefined
      }

      if (this.regexpSearch === true) {
        // Don't automatically start a search b/c certain expressions will crash
        // the process (such as searching for /.*/ in a large document)
        return
      }

      this.findTimeout = setTimeout(() => {
        this.searchNext()
        this.findTimeout = undefined
      }, 1000)
    },
    showSearch: function (newValue, oldValue) {
      if (newValue === true && oldValue === false) {
        // The user activated search, so focus the input and run a search (if
        // the query wasnt' empty)
        this.$nextTick(() => {
          this.$refs['search-input'].focus()
          this.searchNext()
        })
      } else if (newValue === false) {
        // Always "stopSearch" if the input is not shown, since this will clear
        // out, e.g., the matches on the scrollbar
        this.editor.stopSearch()
      }
    }
  },
  mounted: function () {
    // As soon as the component is mounted, initiate the editor
    this.editor = new MarkdownEditor(this.$refs.textarea, this.editorConfiguration)

    // Update the document info on corresponding events
    this.editor.on('change', (changeObj) => {
      this.$store.commit('activeDocumentInfo', this.editor.documentInfo)
      // this.activeDocument.modified = this.activeDocument.cmDoc.isClean()
      // Announce that the file is modified (if applicable) to the whole application
      this.$store.commit('announceModifiedFile', {
        filePath: this.activeDocument.path,
        isClean: this.activeDocument.cmDoc.isClean()
      })

      this.$store.commit('updateTableOfContents', this.editor.tableOfContents)
    })

    this.editor.on('cursorActivity', () => {
      this.$store.commit('activeDocumentInfo', this.editor.documentInfo)
    })

    this.editor.on('zettelkasten-link', (linkContents) => {
      ipcRenderer.invoke('application', {
        command: 'force-open',
        payload: linkContents
      })
        .catch(err => console.error(err))

      if (global.config.get('zkn.autoSearch') === true) {
        this.$root.$emit('start-global-search', linkContents)
      }
    })
    this.editor.on('zettelkasten-tag', (tag) => {
      this.$root.$emit('start-global-search', tag)
    })

    this.$root.$on('search-next', () => {
      this.searchNext()
    })

    // Listen to shortcuts from the main process
    ipcRenderer.on('shortcut', (event, shortcut) => {
      if (shortcut === 'save-file') {
        this.save()
      } else if (shortcut === 'copy-as-html') {
        this.editor.copyAsHTML()
      } else if (shortcut === 'paste-as-plain') {
        this.editor.pasteAsPlainText()
      } else if (shortcut === 'toggle-typewriter-mode') {
        this.editor.hasTypewriterMode = this.editor.hasTypewriterMode === false
      } else if (shortcut === 'search') {
        this.showSearch = this.showSearch === false
      }
    })

    ipcRenderer.on('open-file-changed', (event, fileDescriptor) => {
      // This event is emitted by the main process if the user wants to exchange
      // a file with remote changes. It already ships with the file descriptor
      // so all we have to do is find the right file and just swap the contents.
      // We don't need to update anything else, since that has been updated in
      // the application's store already by the time this event arrives.
      const doc = this.openDocuments.find(item => item.path === fileDescriptor.path)

      if (doc !== undefined) {
        const cur = Object.assign({}, doc.cmDoc.getCursor())
        doc.cmDoc.setValue(fileDescriptor.content)
        this.$nextTick(() => {
          // Wait a little bit for the unwanted modification-events to emit and
          // then immediately revert that status again.
          doc.cmDoc.markClean()
          doc.cmDoc.setCursor(cur)
          this.$store.commit('announceModifiedFile', {
            filePath: doc.path,
            isClean: doc.cmDoc.isClean()
          })
        })
      }
    })

    // Other elements can emit a toc-line event on $root to request a jump to
    // a specific line.
    this.$root.$on('toc-line', (line) => {
      this.editor.jtl(line)
    })

    // Finally, let's observe if the editor element changes. If so, refresh the
    // editor. This will keep the cursor correct when the SplitViews are either
    // opened/closed or resized.
    const obs = new ResizeObserver(entries => {
      this.editor.codeMirror.refresh()
    })

    obs.observe(this.$refs.editor)
  },
  methods: {
    jtl (lineNumber) {
      if (this.editor !== null) {
        this.editor.jtl(lineNumber)
      }
    },
    /**
     * Resolves a file extension to a valid CodeMirror mode
     *
     * @param   {string}  ext  The file extension (with leading dot!)
     *
     * @return  {string}       The corresponding CodeMirror mode. Defaults to multiplex
     */
    resolveMode (ext) {
      switch (ext) {
        case '.tex':
          return 'stex'
        case '.yaml':
        case '.yml':
          return 'yaml'
        case '.json':
          return 'javascript'
        default:
          return 'multiplex'
      }
    },
    save () {
      // Go through all open files, and, if they are modified, save them
      if (this.activeDocument.cmDoc.isClean() === true) {
        return // Nothing to save
      }

      const newContents = this.activeDocument.cmDoc.getValue()
      const currentWordCount = countWords(newContents, this.shouldCountChars)
      const descriptor = {
        path: this.activeDocument.path,
        newContents: this.activeDocument.cmDoc.getValue(),
        offsetWordCount: currentWordCount - this.activeDocument.lastWordCount
      }

      this.activeDocument.lastWordCount = currentWordCount

      ipcRenderer.invoke('application', {
        command: 'file-save',
        payload: descriptor
      })
        .then((result) => {
          if (result !== true) {
            console.error('Retrieved a falsy result from main, indicating an error with saving the file.')
            return
          }

          // Everything worked out, so clean up
          this.activeDocument.cmDoc.markClean()
          this.$store.dispatch('regenerateTagSuggestions').catch(e => console.error(e))
          this.$store.commit('announceModifiedFile', {
            filePath: this.activeDocument.path,
            isClean: this.activeDocument.cmDoc.isClean()
          })

          // Also, extract all cited keys
          this.updateCitationKeys()
        })
        .catch((err) => { console.error(err) })
    },
    updateCitationKeys: function () {
      const value = this.editor.value

      const citations = citrUtil.extractCitations(value)
      const keys = []
      for (const citation of citations) {
        try {
          const cslArray = parseSingle(citation)
          for (const csl of cslArray) {
            keys.push(csl.id)
          }
        } catch (err) {
          // If an invalid citation was passed, make sure to include the rest
          // either way. But log the error just in case.
          console.error(err)
        }
      }
      this.$store.commit('updateCitationKeys', keys)
    },
    toggleQueryRegexp () {
      const isRegexp = /^\/.+\/[gimy]{0,4}$/.test(this.query.trim())

      if (isRegexp) {
        const match = /^\/(.+)\/[gimy]{0,4}$/.exec(this.query.trim())
        if (match !== null) {
          this.query = match[1]
        }
      } else {
        this.query = `/${this.query}/`
      }
    },
    executeCommand (cmd) {
      // Executes a markdown command on the editor instance
      this.editor.runCommand(cmd)
      this.editor.focus()
    },
    // SEARCH FUNCTIONALITY BLOCK
    searchNext () {
      // Make sure to clear out a timeout to prevent Zettlr from auto-searching
      // again after the user deliberately searched by pressing Enter.
      if (this.findTimeout !== undefined) {
        clearTimeout(this.findTimeout)
        this.findTimeout = undefined
      }

      this.editor.searchNext(this.query)
    },
    searchPrevious () {
      this.editor.searchPrevious(this.query)
    },
    replaceNext () {
      this.editor.replaceNext(this.query, this.replaceString)
    },
    replacePrevious () {
      this.editor.replacePrevious(this.query, this.replaceString)
    },
    replaceAll () {
      this.editor.replaceAll(this.query, this.replaceString)
    },
    /**
     * Scrolls the editor according to the value if the user scrolls left of the
     * .CodeMirror-scroll element
     *
     * @param   {WheelEvent}  event  The mousewheel event
     */
    onEditorScroll (event) {
      if (event.target !== this.$refs.editor) {
        return // Only handle if the event's target is the editor itself
      }

      const scroller = this.$refs.editor.querySelector('.CodeMirror-scroll')

      if (scroller !== null) {
        scroller.scrollTop += event.deltaY
      }
    },
    /**
     * Triggers when the user presses any mouse button
     *
     * @param   {MouseEvent}  event  The mouse event
     */
    editorMousedown (event) {
      // start selecting lines only if we are on the left margin and the left mouse button is pressed
      if (event.target !== this.$refs.editor || event.button !== 0) {
        return
      }

      // set the start point of the selection to be where the mouse was clicked
      this.anchor = this.editor.codeMirror.coordsChar({ left: event.pageX, top: event.pageY })
      this.editor.codeMirror.setSelection(this.anchor)
    },

    editorMousemove (event) {
      if (this.anchor === undefined) {
        return
      }
      // get the point where the mouse has moved
      const addPoint = this.editor.codeMirror.coordsChar({ left: event.pageX, top: event.pageY })
      // use the original start point where the mouse first was clicked
      // and change the end point to where the mouse has moved so far
      this.editor.codeMirror.setSelection(this.anchor, addPoint)
    },
    /**
     * Triggers when the user releases any mouse button
     *
     * @param   {MouseEvent}  event  The mouse event
     */
    editorMouseup (event) {
      if (this.anchor === undefined) {
        // This event gets also fired when someone, e.g., wants to edit an image
        // caption, so we must explicitly check if we are currently in a left-
        // side selection event, and if we aren't, don't do anything.
        return
      }

      // when the mouse is released, set anchor to undefined to stop adding lines
      this.anchor = undefined
      // Also, make sure the editor is focused.
      this.editor.codeMirror.focus()
    },
    addKeywordsToFile (keywords) {
      // Split the contents of the editor into frontmatter and contents, then
      // add the keywords to the frontmatter, slice everything back together
      // and then overwrite the editor's contents.
      let { frontmatter, content } = extractYamlFrontmatter(this.editor.value) // NOTE: We can keep the linefeed to \n since CodeMirror is set to ALWAYS use \n

      let postFrontmatter = '\n'
      if (frontmatter !== null) {
        if ('keywords' in frontmatter) {
          frontmatter.keywords = frontmatter.keywords.concat(keywords)
        } else if ('tags' in frontmatter) {
          frontmatter.tags = frontmatter.tags.concat(keywords)
        } else {
          frontmatter.keywords = keywords
        }
      } else {
        // Frontmatter was null, so create one
        frontmatter = {}
        frontmatter.keywords = keywords
        postFrontmatter += '\n' // Make sure if we're now ADDING a frontmatter to space it from the content
      }

      // Glue it back together and set it as content
      this.activeDocument.cmDoc.setValue('---\n' + YAML.stringify(frontmatter) + '---' + postFrontmatter + content)
    }
  }
}
</script>

<style lang="less">
// Editor Geometry

// Editor margins left and right for all breakpoints in both fullscreen and
// normal mode.
@editor-margin-fullscreen-sm:   50px;
@editor-margin-fullscreen-md:  5vw;
@editor-margin-fullscreen-lg:  10vw;
@editor-margin-fullscreen-xl:  20vw;
@editor-margin-fullscreen-xxl: 30vw;

@editor-margin-normal-sm:  20px;
@editor-margin-normal-md:  50px;
@editor-margin-normal-lg: 100px;

#editor {
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  background-color: #ffffff;
  transition: 0.2s background-color ease;

  // .katex {
  //   display: inline-block;
  //   width: 100%;
  //   text-align: center;
  // }

  div#editor-search {
    position: absolute;
    width: 300px;
    right: 0;
    z-index: 7; // One less and the scrollbar will on top of the input field
    padding: 5px 10px;

    div.row { display: flex; }

    input {
      flex: 3;
      &.monospace { font-family: monospace; }
    }

    button {
      flex: 1;
      max-width: 24px;
    }
  }

  .CodeMirror {
    // The CodeMirror editor needs to respect the new tabbar; it cannot take
    // up 100 % all for itself anymore.
    margin-left: 0.5em;
    height: 100%;
    font-family: inherit;
    // background: none;

    @media(min-width: 1025px) { margin-left: @editor-margin-normal-lg; }
    @media(max-width: 1024px) { margin-left: @editor-margin-normal-md; }
    @media(max-width:  900px) { margin-left: @editor-margin-normal-sm; }
  }

  // If a code file is loaded, we need to display the editor contents in monospace.
  &.monospace .CodeMirror {
    font-family: monospace;

    // We're using this solarized theme here: https://ethanschoonover.com/solarized/
    // See also the CodeEditor.vue component, which uses the same colours
    @base03:    #002b36;
    @base02:    #073642;
    @base01:    #586e75;
    @base00:    #657b83;
    @base0:     #839496;
    @base1:     #93a1a1;
    @base2:     #eee8d5;
    @base3:     #fdf6e3;
    @yellow:    #b58900;
    @orange:    #cb4b16;
    @red:       #dc322f;
    @magenta:   #d33682;
    @violet:    #6c71c4;
    @blue:      #268bd2;
    @cyan:      #2aa198;
    @green:     #859900;

    color: @base01;
    .cm-string     { color: @green; }
    .cm-string-2   { color: @green; }
    .cm-keyword    { color: @green; }
    .cm-atom       { color: @green; }
    .cm-tag        { color: @blue; }
    .cm-qualifier  { color: @blue; }
    .cm-builtin    { color: @blue; }
    .cm-variable-2 { color: @yellow; }
    .cm-variable   { color: @yellow; }
    .cm-comment    { color: @base1; }
    .cm-attribute  { color: @orange; }
    .cm-property   { color: @magenta; }
    .cm-type       { color: @red; }
    .cm-number     { color: @violet; }
  }

  .CodeMirror-code {
    margin: 5em 0em;
    @media(max-width: 1024px) { margin: @editor-margin-fullscreen-md 0em; }

    .mute { opacity:0.2; }
  }

  .CodeMirror-scroll {
    padding-right: 5em;
    @media(min-width: 1025px) { padding-right: @editor-margin-normal-lg; }
    @media(max-width: 1024px) { padding-right: @editor-margin-normal-md; }
    @media(max-width:  900px) { padding-right: @editor-margin-normal-sm; }
    overflow-x: hidden !important; // Necessary to hide the horizontal scrollbar

    // We need to override a negative margin
    // and a bottom padding from the standard
    // CSS for some calculations to be correct
    // such as the table editor
    margin-bottom: 0px;
    padding-bottom: 0px;
  }

  .CodeMirror.CodeMirror-readonly {
    .CodeMirror-cursor { display: none !important; }
  }

  // Reduce font size of math a bit
  .katex { font-size: 1.1em; }
}

body.dark #editor {
  background-color: rgba(20, 20, 30, 1);
}

body.darwin #editor {
  // On macOS the tabbar is 30px high.
  &:not(.fullscreen) {
    height: calc(100% - 30px);
  }

  div#editor-search {
    background-color: rgba(230, 230, 230, 1);
    border-bottom-left-radius: 6px;
    padding: 6px;
    box-shadow: -2px 2px 4px 1px rgba(0, 0, 0, .3);

    input[type="text"], button {
      border-radius: 0;
      margin: 0;
    }

    button:hover { background-color: rgb(240, 240, 240); }
    button.active { background-color: rgb(200, 200, 200) }
  }
}

body.darwin.dark #editor {
  div#editor-search {
    background-color: rgba(60, 60, 60, 1);
  }
}

body.win32 #editor, body.linux #editor {
  // On Windows, the tab bar is 30px high
  &:not(.fullscreen) {
    height: calc(100% - 30px);
  }

  div#editor-search {
    background-color: rgba(230, 230, 230, 1);
    box-shadow: -2px 2px 4px 1px rgba(0, 0, 0, .3);

    button { max-width: fit-content; }
    button, input { border-width: 1px; }

    button:hover { background-color: rgb(240, 240, 240); }
    button.active { background-color: rgb(200, 200, 200) }
  }
}

// CodeMirror fullscreen
#editor.fullscreen {
    .CodeMirror {
    @media(min-width: 1301px) { margin-left: @editor-margin-fullscreen-xxl !important; }
    @media(max-width: 1300px) { margin-left: @editor-margin-fullscreen-xl  !important; }
    @media(max-width: 1100px) { margin-left: @editor-margin-fullscreen-lg  !important; }
    @media(max-width: 1000px) { margin-left: @editor-margin-fullscreen-md  !important; }
    @media(max-width:  800px) { margin-left: @editor-margin-fullscreen-sm  !important; }

    .CodeMirror-scroll {
      @media(min-width: 1301px) { padding-right: @editor-margin-fullscreen-xxl !important; }
      @media(max-width: 1300px) { padding-right: @editor-margin-fullscreen-xl  !important; }
      @media(max-width: 1100px) { padding-right: @editor-margin-fullscreen-lg  !important; }
      @media(max-width: 1000px) { padding-right: @editor-margin-fullscreen-md  !important; }
      @media(max-width:  800px) { padding-right: @editor-margin-fullscreen-sm  !important; }
    }
  }
}

body.darwin {
    #editor.fullscreen {
     border-top: 1px solid #d5d5d5;
  }

  &.dark {
    #editor.fullscreen {
      border-top-color: #505050;
    }
  }
}

// Define the readability classes
.cm-readability-0   { background-color: hsv(52, 27.6%, 96.5%); color: #444444 !important; }
.cm-readability-1   { background-color: hsv( 1, 19.7%, 89.8%); color: #444444 !important; }
.cm-readability-2   { background-color: hsv( 184, 36%, 93.7%); color: #444444 !important; }
.cm-readability-3   { background-color: hsv( 202, 20.4%, 96.1%); color: #444444 !important; }
.cm-readability-4   { background-color: hsv( 31, 41.9%, 90%); color: #444444 !important; }
.cm-readability-5   { background-color: hsv( 91, 36%, 95%); color: #444444 !important; }
.cm-readability-6   { background-color: hsv( 91, 80%, 91%); color: #444444 !important; }
.cm-readability-7   { background-color: hsv( 52, 60%, 40%); color: #444444 !important; }
.cm-readability-8   { background-color: hsv( 1, 62.4%, 52.5%); color: #444444 !important; }
.cm-readability-9   { background-color: hsv( 184, 70%, 45.5%); color: #444444 !important; }
.cm-readability-10  { background-color: hsv( 201, 89%, 24.5%); color: #444444 !important; }
</style>
