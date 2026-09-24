flowchart TD
    %% Global Styling
    classDef startNode fill:#0B192C,stroke:#00BCEB,stroke-width:2px,color:#FFFFFF;
    classDef aiNode fill:#E0F2FE,stroke:#0070D2,stroke-width:2px,color:#0369A1,font-weight:bold;
    classDef gateNode fill:#FEF3C7,stroke:#F59E0B,stroke-width:2px,color:#0F172A,font-weight:bold;
    classDef actionNode fill:#F3E8FF,stroke:#8B5CF6,stroke-width:2px,color:#6D28D9,font-weight:bold;
    classDef queueNode fill:#F0FDF4,stroke:#10B981,stroke-width:2px,color:#065F46,font-weight:bold;
    classDef endNode fill:#ECFDF5,stroke:#10B981,stroke-width:2px,color:#065F46;

    %% Inbound Call
    Start([Inbound Customer Call<br/>Main DID / Branch Office]):::startNode --> AIFrontDoor

    %% Front Door & Context Extraction
    subgraph AI_Front_Door ["1. AI Operator Front Door (Webex Contact Center)"]
        AIFrontDoor["Voice AI Agent Answers Call"]:::aiNode
        Classifier{"2D Classification & Quick Keys<br/>• Who are you: Fleet, B2B, MyLocauto<br/>• What you want: Booking, Rental, CS, Assistance<br/>• Quick Keys: Phone, Booking #, Plate"}:::gateNode
        AIFrontDoor --> Classifier
    end

    %% Knowledge Grounding & Answering
    subgraph Knowledge_Resolution ["2. Autonomous Knowledge Resolution (Phase 1)"]
        KB_Engine[("Locauto Grounded Knowledge Base<br/>• 86 Official Website FAQs (9 Categories)<br/>• Booking Terms & Conditions Car (PDF)<br/>• General Rental Conditions (PDF)<br/>• Special Rental Conditions (PDF)")]:::aiNode
        SpokenAnswer["AI Speaks Grounded Answer<br/>(Concise 1–2 Voice Sentences)<br/>⚠️ Rule 2: NEVER offer transfer in spoken answer"]:::aiNode
        
        Classifier -->|"Informational Query"| KB_Engine
        KB_Engine --> SpokenAnswer
        
        TopicGate{"All Topic Answers<br/>Offered to Customer?"}:::gateNode
        SpokenAnswer --> TopicGate
        TopicGate -->|"No (In Progress)"| SpokenAnswer
        
        AssistGate{"Ask: 'Do you need further<br/>assistance with this?'"}:::gateNode
        TopicGate -->|"Yes (Topic Exhausted)"| AssistGate
        
        EndCall([Graceful Call Conclusion<br/>100% Self-Service Contained]):::endNode
        AssistGate -->|"No (Resolved)"| EndCall
    end

    %% Fulfillment & Escalation Routing
    subgraph Fulfillment_Dispatch ["3. Escalation & External Transfer Dispatcher"]
        AssistGate -->|"Yes (Needs Help)"| ActionClassifier{"Match Customer Need to<br/>1 of 12 Action Tags"}:::gateNode
        Classifier -->|"Complex / Non-KB Intent"| ActionClassifier

        subgraph Actions_12 ["12 Dedicated Action Tags (bot_Action)"]
            A1["Action [Rental]"]:::actionNode
            A2["Action [MyLocauto_Validate]"]:::actionNode
            A3["Action [MyLocauto_Information]"]:::actionNode
            A4["Action [Fines]"]:::actionNode
            A5["Action [Invoices]"]:::actionNode
            A6["Action [Securiry_Deposit]"]:::actionNode
            A7["Action [Damages]"]:::actionNode
            A8["Action [Road_Assistance]"]:::actionNode
            A9["Action [Mechanical_Assistance]"]:::actionNode
            A10["Action [Tyres_Glasses_Assistance]"]:::actionNode
            A11["Action [Car_Body_Assistance]"]:::actionNode
            A12["Action [Sinistri_Assistance]"]:::actionNode
        end

        ActionClassifier --> A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8 & A9 & A10 & A11 & A12
    end

    %% External Queues / Target Systems
    subgraph External_Queues ["4. Target External Queues (1st & 2nd Level Operator Groups)"]
        Q_Preno["External Queue: Preno_Auto<br/>(Branch / Call Center / Long-Term)"]:::queueNode
        Q_Convalida["External Queue: Convalida<br/>(MyLocauto Commercial Team)"]:::queueNode
        Q_Elefast["External Queue: Info_Elefast<br/>(Loyalty / Elefast Helpdesk)"]:::queueNode
        Q_Multe["External Queue: Multe<br/>(2nd Level CS / Fines Operator)"]:::queueNode
        Q_Fatture["External Queue: Fatture<br/>(2nd Level Accounting Operator)"]:::queueNode
        Q_Deposito["External Queue: Deposito_cauzionale<br/>(Administrative Operator)"]:::queueNode
        Q_Danni["External Queue: Danni<br/>(2nd Level Damage Desk)"]:::queueNode
        Q_Soccorso["External Queue: Soccorso_stradale<br/>(Rescue / Road Assistance Team)"]:::queueNode
        Q_Meccanica["External Queue: Meccanica<br/>(Maintenance / Workshop Team)"]:::queueNode
        Q_Pneumatici["External Queue: Pneumatici_critalli<br/>(Tyres & Glass Specialist)"]:::queueNode
        Q_Carrozzeria["External Queue: Carrozeria<br/>(Bodywork Repair Desk)"]:::queueNode
        Q_Sinistri["External Queue: Assistenza_sinistri<br/>(Insurance & Claims Operator)"]:::queueNode

        A1 --> Q_Preno
        A2 --> Q_Convalida
        A3 --> Q_Elefast
        A4 --> Q_Multe
        A5 --> Q_Fatture
        A6 --> Q_Deposito
        A7 --> Q_Danni
        A8 --> Q_Soccorso
        A9 --> Q_Meccanica
        A10 --> Q_Pneumatici
        A11 --> Q_Carrozzeria
        A12 --> Q_Sinistri
    end