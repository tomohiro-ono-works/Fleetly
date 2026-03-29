from slack_client import SlackClient, PostMode

client = SlackClient()

try:
    # ① 起動（初回は必ずGUI）
    client.launch(
        headless=True,
        user_data_dir="profile"
        # storage_state_path="state.json"
    )

    # ② ログイン待ち
    client.wait_for_login()

    # ③ チャンネル移動
    # client.open_channel(channel_name="web_hook_test")
    # or
    client.open_channel(channel_url="https://app.slack.com/client/TVCTWGKR7/C0AHS6FLDRQ")

    # ④ 投稿
    result = client.post_message(
        "テスト投稿",
        mode=PostMode.SEND
    )

    print(result)

finally:
    client.close()