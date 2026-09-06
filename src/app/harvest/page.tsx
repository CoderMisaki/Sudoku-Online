import { redirect } from 'next/navigation';

/**
 * PWA entry point for the Harvest manifest (`start_url: /harvest`).
 * Sends the player to the lobby with Harvest Moon preselected so an installed
 * game PWA never lands on a 404.
 */
export default function HarvestIndexPage() {
  redirect('/?game=harvest');
}
