# 제일강동지역아동센터 관찰일지 웹앱

정적 `HTML/CSS/JavaScript` 프론트엔드와 Google Sheets, Google Apps Script Web App으로 동작하는 관찰일지 시스템입니다. 서버, Vercel, Next.js, React, Node.js, 별도 DB를 사용하지 않습니다.

## 파일 구성

- `index.html`: 멘토용 화면
- `admin.html`: 관리자용 화면
- `style.css`: 공통 스타일
- `mentor.js`: 멘토 화면 로직
- `admin.js`: 관리자 화면 로직
- `Code.gs`: Google Apps Script 백엔드
- `README.md`: 배포 및 설정 안내

## 기본 접속 정보

프론트엔드 시스템 비밀번호 기본값은 `1234`입니다. 이 값은 단순 접근 차단용이며 실제 데이터 접근 권한은 `Code.gs`에서 토큰과 PIN으로 다시 검증합니다.

Apps Script 설정 탭의 기본 관리자 PIN은 `9999`로 자동 생성됩니다. 운영 전 반드시 변경하세요.

## Google Sheets 구성

이 프로젝트는 아래 Google Sheets 문서와 연결되도록 `Code.gs`에 스프레드시트 ID가 설정되어 있습니다.

- 데이터페이지: https://docs.google.com/spreadsheets/d/1CvJq8NTV0aCGPq9qHPBL6adUYUfDvHq2RTlOG-gD9eI/edit?hl=ko&gid=0#gid=0
- 스프레드시트 ID: `1CvJq8NTV0aCGPq9qHPBL6adUYUfDvHq2RTlOG-gD9eI`

1. 위 Google Sheets 문서를 엽니다.
2. 메뉴에서 `확장 프로그램` → `Apps Script`를 엽니다.
3. Apps Script 편집기의 기본 코드를 지우고 `Code.gs` 전체 내용을 붙여 넣습니다.
4. 저장 후 함수 선택 드롭다운에서 `setupSheets`를 선택하고 실행합니다.
5. 권한 승인 후 해당 스프레드시트에 아래 탭과 헤더가 생성됩니다.

생성되는 탭:

- `멘토관리`: 멘토명, PIN, 이메일, 사용여부
- `삭제멘토`: 멘토명, PIN, 이메일, 사용여부, 삭제일시, 삭제자
- `아동관리`: 아동ID, 아동명, 그룹, 기본담당멘토, 사용여부, 과목, 활동요일
- `작성대상`
- `관찰일지_취합`
- `설정`
- `특정일자설정`
- `알림로그`

## 초기 데이터 입력

`멘토관리` 예시:

| 멘토명 | PIN | 이메일 | 사용여부 |
|---|---|---|---|
| 김멘토 | 1111 | mentor@example.com | Y |

`아동관리` 예시:

| 아동ID | 아동명 | 그룹 | 기본담당멘토 | 사용여부 | 과목 | 활동요일 |
|---|---|---|---|---|---|---|
| C001 | 정하늘 | 초등A | 김멘토 | Y | 수학 | 월,수 |

관리자 화면의 `멘토관리` 메뉴에서 멘토명, PIN, 이메일을 저장하면 `멘토관리` 탭에 반영됩니다. 멘토 삭제 버튼을 누르면 `멘토관리` 탭의 행은 `삭제멘토` 탭으로 이관되고, 기존 관찰일지 데이터는 삭제되지 않습니다. 같은 메뉴에서 아동별 담당 멘토, 과목, 활동 요일을 저장하면 `아동관리` 탭의 `기본담당멘토`, `과목`, `활동요일` 값이 갱신됩니다.

`설정` 탭에서 필요 시 아래 값을 수정합니다.

- `DEFAULT_DEADLINE_TIME`: 기본 마감시간
- `GLOBAL_NOTIFICATION`: 전체 알림 `ON` 또는 `OFF`
- `ADMIN_PIN`: 관리자 PIN
- `ADMIN_EMAIL`: 관리자 미작성 요약 수신 이메일

## Apps Script Web App 배포

1. Apps Script 편집기 오른쪽 위 `배포` → `새 배포`를 누릅니다.
2. 유형 선택에서 `웹 앱`을 선택합니다.
3. 실행 권한은 `나`로 설정합니다.
4. 액세스 권한은 GitHub Pages에서 호출할 수 있도록 `모든 사용자` 또는 조직 정책에 맞는 공개 범위로 설정합니다.
5. 배포 후 표시되는 Web App URL을 복사합니다.
6. `mentor.js`, `admin.js`의 `APP_CONFIG.API_URL` 값을 복사한 URL로 교체합니다.

```js
const APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/배포ID/exec",
  SYSTEM_PASSWORD_HASH: "..."
};
```

## GitHub Pages 배포

1. 이 폴더의 파일을 GitHub 저장소 루트에 올립니다.
2. GitHub 저장소에서 `Settings` → `Pages`로 이동합니다.
3. `Build and deployment`의 Source를 `Deploy from a branch`로 선택합니다.
4. Branch는 `main`, 폴더는 `/root`를 선택하고 저장합니다.
5. 배포 URL에서 `index.html`은 멘토용, `admin.html`은 관리자용으로 접속합니다.

## 실제 API 연동

예시용 더미 데이터는 제거되어 있습니다. `mentor.js`, `admin.js`의 `API_URL`이 `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` 상태이면 데이터 조회/저장을 하지 않고 설정 안내 오류를 표시합니다.

운영하려면 Apps Script Web App URL을 반드시 넣어야 합니다. 제출, 수정, 조회, 알림은 모두 `Code.gs`에서 처리하며, `Code.gs`는 위 스프레드시트 ID를 기준으로 데이터를 읽고 씁니다.

## 운영 규칙

- 기본 작성/알림 대상은 평일입니다.
- 주말은 기본 제외입니다.
- 평일 공휴일 또는 휴관일은 `특정일자설정`에서 `작성제외`로 등록합니다.
- 주말 또는 공휴일 보강 운영은 `특정일자설정`에서 `예외작성`으로 등록합니다.
- 특정일자 설정이 있으면 기본 요일 계산보다 우선합니다.
- 전체 알림이 `OFF`이면 모든 알림이 발송되지 않습니다.
- 특정일자 알림이 `OFF`이면 해당 날짜 알림이 발송되지 않습니다.

## 보안 메모

- 시스템 비밀번호는 프론트엔드 접근 차단용입니다.
- 멘토 로그인, 관리자 로그인, 제출, 수정, 조회 권한은 Apps Script에서 검증합니다.
- 멘토가 제출할 때 Apps Script가 아동, 날짜, 중복 제출, 작성 가능 여부를 다시 확인합니다.
- 관리자 데이터 조회는 관리자 PIN 로그인 후 발급된 토큰으로만 가능합니다.

## 알림

관리자 화면의 `미작성 알림 발송` 버튼을 누르면 Gmail 알림을 발송합니다.

- 같은 날짜 + 같은 아동 + 같은 알림유형에 대해 성공 로그가 있으면 중복 발송하지 않습니다.
- 다른 멘토가 대신 작성한 아동은 미작성으로 보지 않습니다.
- 결과는 `알림로그` 탭에 기록됩니다.

자동 알림을 원하면 Apps Script 트리거에서 시간 기반 트리거를 만들고 `sendMissingNotifications`를 직접 호출하는 래퍼 함수를 추가해 운영 시간에 맞게 연결하면 됩니다.
