import { useEffect, useState } from 'react'
import { prototypes } from './prototypes'

const current = () => location.hash.replace('#/', '') || 'spin' // the site opens straight into Spin; the list of prototypes lives at #/lab

export default function App() {
  const [slug, setSlug] = useState(current())
  useEffect(() => {
    const on = () => setSlug(current())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const Proto = prototypes.find((p) => p.slug === slug)?.component
  return (
    <div className="stage">
      <div className="screen">
        {Proto ? (
          <Proto />
        ) : (
          <div className="home">
            <h1>mobile-lab</h1>
            <p>Pick a prototype</p>
            {prototypes.map((p) => (
              <a key={p.slug} href={`#/${p.slug}`}>{p.title}</a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
