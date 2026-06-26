import React from 'react'

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | undefined | null
  fallback?: React.ReactNode
}

export const SafeImage: React.FC<SafeImageProps> = ({ src, fallback, ...props }) => {
  const isValid = src && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/'))
  if (!isValid) {
    return fallback ?? null
  }
  return <img src={src} {...props} />
}
