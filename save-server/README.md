# 별빛 숲 RPG 기기별 세이브 서버

이 서버는 멀티플레이 서버와 별도로 동작하며, 기기별 자동 저장 데이터를 Supabase PostgreSQL에 보관합니다.

## Supabase 설정
1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `schema.sql` 내용을 실행합니다.
3. Project Settings → API에서 Project URL과 service_role key를 확인합니다.
4. 두 값은 Render의 `starlight-device-save-server` 서비스 Environment에만 입력합니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. service_role key를 게임 HTML, GitHub 공개 파일, 채팅에 붙여 넣지 마세요.

## Render
Render Blueprint가 `starlight-device-save-server` 서비스를 추가합니다.
환경 변수를 설정하면 `/\` 상태 응답의 `databaseConfigured`가 true가 됩니다.

## 저장 방식
브라우저가 만든 UUID를 기기 저장 ID로 사용합니다. 계정이나 비밀번호는 없습니다.
브라우저 저장 데이터/사이트 데이터를 삭제하면 ID를 잃을 수 있고, 다른 기기에서는 자동으로 불러오지 않습니다.
