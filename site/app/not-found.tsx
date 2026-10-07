import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="hero">
      <h1>Not found</h1>
      <p className="lede">No page here. The <Link href="/suites/">leaderboards</Link> list every published run.</p>
    </div>
  );
}
