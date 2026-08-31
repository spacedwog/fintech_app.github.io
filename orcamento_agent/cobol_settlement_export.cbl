       >>SOURCE FORMAT FREE
       IDENTIFICATION DIVISION.
       PROGRAM-ID. COBOL-SETTLEMENT-EXPORT.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT COBOL-IN ASSIGN TO "cobol_settlements_input.csv"
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT JSON-OUT ASSIGN TO "cobol_events.json"
               ORGANIZATION IS LINE SEQUENTIAL.

       DATA DIVISION.
       FILE SECTION.
       FD COBOL-IN.
       01 COBOL-LINE                     PIC X(512).
       FD JSON-OUT.
       01 JSON-LINE                      PIC X(2048).

       WORKING-STORAGE SECTION.
       77 EOF-FLAG                       PIC X VALUE "N".
       77 FIRST-FLAG                     PIC X VALUE "Y".
       77 EVENT-ID                       PIC X(64).
       77 TENANT-ID                      PIC X(64).
       77 PAYMENT-ID                     PIC X(64).
       77 TXID                           PIC X(64).
       77 AMOUNT                         PIC X(32).
       77 STATUS-QUITACAO                PIC X(32).
       77 SETTLED-AT                     PIC X(40).
       77 LIQUIDATION-REFERENCE          PIC X(64).

       PROCEDURE DIVISION.
           OPEN INPUT COBOL-IN
                OUTPUT JSON-OUT

           MOVE "[" TO JSON-LINE
           WRITE JSON-LINE

           PERFORM UNTIL EOF-FLAG = "Y"
               READ COBOL-IN
                   AT END
                       MOVE "Y" TO EOF-FLAG
                   NOT AT END
                       PERFORM PARSE-LINE
                       PERFORM WRITE-JSON-EVENT
               END-READ
           END-PERFORM

           MOVE "]" TO JSON-LINE
           WRITE JSON-LINE

           CLOSE COBOL-IN JSON-OUT
           GOBACK.

       PARSE-LINE.
           MOVE SPACES TO EVENT-ID TENANT-ID PAYMENT-ID TXID AMOUNT
                          STATUS-QUITACAO SETTLED-AT LIQUIDATION-REFERENCE
           UNSTRING COBOL-LINE DELIMITED BY ";"
               INTO EVENT-ID
                    TENANT-ID
                    PAYMENT-ID
                    TXID
                    AMOUNT
                    STATUS-QUITACAO
                    SETTLED-AT
                    LIQUIDATION-REFERENCE
           END-UNSTRING.

       WRITE-JSON-EVENT.
           IF FIRST-FLAG = "Y"
               MOVE "N" TO FIRST-FLAG
           ELSE
               MOVE "," TO JSON-LINE
               WRITE JSON-LINE
           END-IF

           STRING
               "  {"
               '"event_id": "' FUNCTION TRIM(EVENT-ID) '", '
               '"tenant_id": "' FUNCTION TRIM(TENANT-ID) '", '
               '"tipo": "PAYMENT_SETTLEMENT", '
               '"payment_id": "' FUNCTION TRIM(PAYMENT-ID) '", '
               '"txid": "' FUNCTION TRIM(TXID) '", '
               '"amount": ' FUNCTION TRIM(AMOUNT) ', '
               '"status_quitacao": "' FUNCTION TRIM(STATUS-QUITACAO) '", '
               '"settled_at": "' FUNCTION TRIM(SETTLED-AT) '", '
               '"liquidation_reference": "' FUNCTION TRIM(LIQUIDATION-REFERENCE) '", '
               '"source_system": "IBM_COBOL"'
               "}"
               INTO JSON-LINE
           END-STRING

           WRITE JSON-LINE.
       END PROGRAM COBOL-SETTLEMENT-EXPORT.
