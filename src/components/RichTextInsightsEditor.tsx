import { useEffect, type FocusEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  normalizeStoredToTipTapHtml,
  trimTrailingEmptyEditorHtml,
} from '../lib/richText'

function looseHtmlEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/<p>\s*<\/p>/gi, '')
      .replace(/<p><br[^>]*><\/p>/gi, '')
      .trim()
  return norm(a) === norm(b)
}

type Props = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}

export function RichTextInsightsEditor({
  value,
  onChange,
  placeholder = 'Type here…',
  className = '',
}: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeStoredToTipTapHtml(value) || '<p></p>',
    editorProps: {
      attributes: {
        class: 'insights-rich-editor-inner',
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
    },
  })

  useEffect(() => {
    if (!editor) return
    const next = normalizeStoredToTipTapHtml(value) || '<p></p>'
    const cur = editor.getHTML()
    if (looseHtmlEqual(cur, next)) return
    editor.commands.setContent(next, { emitUpdate: false })
  }, [value, editor])

  function onEditorBlur(e: FocusEvent<HTMLDivElement>) {
    if (!editor) return
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    const html = trimTrailingEmptyEditorHtml(editor.getHTML())
    if (html !== editor.getHTML()) onChange(html)
  }

  return (
    <div
      className={`insights-rich-editor ${className}`.trim()}
      onBlur={onEditorBlur}
    >
      <div
        className="insights-rich-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <button
          type="button"
          className="insights-rich-tool"
          disabled={!editor}
          aria-pressed={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className="insights-rich-tool"
          disabled={!editor}
          aria-pressed={editor?.isActive('underline') ?? false}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          Underline
        </button>
      </div>
      <EditorContent editor={editor} className="insights-rich-editor-content" />
    </div>
  )
}
