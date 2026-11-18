# 선택형 Claude 연결 도구

Node.js 20 이상과 설치·인증된 Claude Code CLI가 필요합니다. 공통 협업 스킬은 이 도구 없이도 공유 파일 방식으로 사용할 수 있습니다.

프로젝트 루트에서 실행합니다.

```powershell
node 도구/claude-bridge/verify.mjs
node 도구/claude-bridge/bridge.mjs status --task project-start
node 도구/claude-bridge/bridge.mjs send --file Claude-회의요청.txt --from codex-1 --task project-start
node 도구/claude-bridge/bridge.mjs history --task project-start
```

배포본은 업무 ID별로 저장 폴더와 세션을 분리합니다. 경로는 프로젝트 루트 아래 협의/<업무ID>/대화이며, 기본 업무 ID는 default입니다. 같은 업무는 세션을 이어가고 다른 업무는 별도 세션을 만듭니다. 발신자는 --from으로 구분합니다. ID는 인증 정보가 아닌 자기 선언입니다.

전송 로그에는 요청·응답 원문과 대응 ID·기록자·세션을 남깁니다. 협업 의사결정 메시지는 별도로 기록합니다. CLI의 권한 검사를 우회하지 않으며, 자동 재전송은 하지 않습니다. 기본 제한 시간은 180초입니다. 시간 초과 뒤에는 실제 도달 여부를 먼저 확인합니다. 강제 종료 후 남은 잠금은 생성자와 진행 중인 전송을 확인한 뒤 메인지침에 따라 정리합니다.

호출된 Claude는 전용 CLI 세션이며 기존 화면 대화와 동일하지 않습니다. 대화 전용 호출이므로 내장 파일·실행 도구와 MCP 서버를 제공하지 않습니다. 검토 자료와 실제 검증 결과를 메시지에 포함해야 합니다. 준비된 [초기 요청](../../Claude-회의요청.txt)에는 패키지 지침이 포함되어 있습니다. 일반 CLI의 기존 시작 설정은 적용될 수 있습니다.

실행 파일은 PATH와 일반 설치 위치에서 찾습니다. 발견되지 않으면 CLAUDE_BRIDGE_EXE에 실제 실행 파일 경로를 지정합니다. 인증 정보는 소스나 메시지에 넣지 않습니다. 네트워크·세션 저장 권한이 차단되면 실행 환경의 정식 승인 절차를 사용합니다.

원리는 [Claude 공식 프로그램 실행 안내](https://code.claude.com/docs/en/headless)를 따릅니다. 다른 제품 호출 연결부는 포함하지 않았습니다. 자세한 운영은 [사용 가이드](../../사용가이드.md)를 참고합니다.
