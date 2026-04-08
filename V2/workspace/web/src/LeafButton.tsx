import React from 'react'
import oneLeafPng from './assets/1-OLD-leaf.png'

export function LeafButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
) {
  const { style, children, ...rest } = props

  return (
    <button
      {...rest}
      style={{
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        width: '196px',
        minWidth: '196px',
        height: '112px',
        padding: '0 32px',
        boxSizing: 'border-box',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'center',
        ...style,
      }}
    >
      {/* leaf behind */}
      <img
        src={oneLeafPng}
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* text on top */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: '118px',
          minHeight: '2.6em',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'normal',
          overflowWrap: 'break-word',
        }}
      >
        {children}
      </span>
    </button>
  )
}

// import React from 'react'
// import leafPng from './assets/leaf.png'
// import oneLeafPng from './assets/1-OLD-leaf.png'

// // Inline temporary data URI placeholders as fallbacks.
// // Primary sources are expected in Vite's public folder at `/images/npec_leaf.png` and `/images/npec_full_logo.jpg`.
// const fallbackLeafDataURI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABFUlEQVRYhe3XsQ2CQBSF4W9gAQR0AQR0AQR0AAewAAdwAAdwAB24hQ7ZJbJgk2ysT2Hh7mXnnJI0z8pKsiIj0EVe8CF41gK49wCj8wA38CBrvAQb4CCF0H+HjQW4B3eABvYAxvQADugCtbYJqJoGQWcF3ie5zXyM4A4W05ACcdedqk4v9n8kJHn6PAdp6C9CqnwDb+pnr2G0LwHlsKqfAJP4CWv4DWeQdYmqvAPXIDXyL65o2AzvgHPcgr/tfAbLqvQkuJ6XBGvZtLrZ9tYxVv3Rd9lE2sLUgqt2nZg7xC+vLuQfd6j0oZSNAAAAAElFTkSuQmCC'
// const publicLeafPath = '/images/npec_leaf.png'
// const leafLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABFUlEQVRYhe3XsQ2CQBSF4W9gAQR0AQR0AQR0AAewAAdwAAdwAB24hQ7ZJbJgk2ysT2Hh7mXnnJI0z8pKsiIj0EVe8CF41gK49wCj8wA38CBrvAQb4CCF0H+HjQW4B3eABvYAxvQADugCtbYJqJoGQWcF3ie5zXyM4A4W05ACcdedqk4v9n8kJHn6PAdp6C9CqnwDb+pnr2G0LwHlsKqfAJP4CWv4DWeQdYmqvAPXIDXyL65o2AzvgHPcgr/tfAbLqvQkuJ6XBGvZtLrZ9tYxVv3Rd9lE2sLUgqt2nZg7xC+vLuQfd6j0oZSNAAAAAElFTkSuQmCC'

// // Fallback chain: leafLogo, then the imported small leaf asset, then public path, then fallback data URI.
// const leafBgUrl = leafLogo || oneLeafPng || leafPng || publicLeafPath || fallbackLeafDataURI

// export function LeafButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) {
//   const { style, children, ...rest } = props
//   return (
//     <button
//       {...rest}
//       style={{
//         display: 'inline-flex',
//         alignItems: 'center',
//         justifyContent: 'center',
//         gap: '8px',
//         padding: '8px 16px',
//         minHeight: '38px',
//         ...style
//       }}
//     >
//       <span style={{ display: 'inline-flex', alignItems: 'center' }}>
//         {children}
//       </span>
//       <img 
//         src={leafBgUrl} 
//         alt="" 
//         style={{ 
//           width: '32px', 
//           height: '32px',
//           flexShrink: 0,
//           pointerEvents: 'none',
//           objectFit: 'contain'
//         }} 
//       />
//     </button>
//   )
// }
