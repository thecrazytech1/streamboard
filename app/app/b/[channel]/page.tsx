import ChannelBoard from "../../components/ChannelBoard";

export default async function ChannelBoardPage({
  params,
}: {
  params: Promise<{ channel: string }>;
}) {
  const { channel } = await params;

  return <ChannelBoard login={decodeURIComponent(channel).toLowerCase()} />;
}
