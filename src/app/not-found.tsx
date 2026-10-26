import Link from "next/link";
export default function NotFound() {
  return (
    <div className="page-loading">
      <h1>That page isn’t on the menu.</h1>
      <p>Let’s get you back to Smart Mess.</p>
      <Link className="button primary" href="/login">
        Back to sign in
      </Link>
    </div>
  );
}
