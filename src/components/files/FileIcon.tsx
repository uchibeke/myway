import {
  Folder, File, FileText, FileCode, FileJson, FileImage,
  FileVideo, FileAudio, FileArchive, FileSpreadsheet, FileType2, Database,
} from 'lucide-react'
import { getCategory, type FileCategory } from '@/lib/file-types'

type Props = {
  ext?: string | null
  category?: FileCategory
  isDir?: boolean
  size?: number
  className?: string
}

const ICON_MAP: Record<FileCategory, { icon: React.ElementType; color: string }> = {
  image:    { icon: FileImage,       color: 'text-pink-400' },
  video:    { icon: FileVideo,       color: 'text-purple-400' },
  audio:    { icon: FileAudio,       color: 'text-indigo-400' },
  pdf:         { icon: FileText,        color: 'text-rose-400' },
  document:    { icon: FileType2,       color: 'text-sky-400' },
  spreadsheet: { icon: FileSpreadsheet, color: 'text-emerald-400' },
  markdown:    { icon: FileText,        color: 'text-blue-400' },
  code:     { icon: FileCode,        color: 'text-cyan-400' },
  data:     { icon: FileJson,        color: 'text-amber-400' },
  text:     { icon: FileText,        color: 'text-zinc-300' },
  archive:  { icon: FileArchive,     color: 'text-orange-400' },
  binary:   { icon: File,            color: 'text-zinc-500' },
}

export default function FileIcon({ ext, category, isDir, size = 18, className = '' }: Props) {
  if (isDir) {
    return <Folder size={size} className={`text-yellow-400 shrink-0 ${className}`} />
  }

  const resolved = category ?? (ext ? getCategory(ext) : 'binary')
  const { icon: Icon, color } = ICON_MAP[resolved] ?? ICON_MAP.binary

  return <Icon size={size} className={`${color} shrink-0 ${className}`} />
}
